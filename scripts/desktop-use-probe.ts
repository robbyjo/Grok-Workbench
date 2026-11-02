import { _electron as electron, type ElectronApplication } from '@playwright/test';
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  copyFile,
  rm,
  realpath,
  lstat,
} from 'node:fs/promises';
import { resolve, join, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { EmbeddedRpc } from '../electron/embedded-rpc';
import { RpcProcess } from '../electron/rpc';
import { embeddedEngine } from '../electron/runtime';
import type { Wire } from '../shared/types';
import { version } from '../package.json';

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const args = process.argv.slice(2);
function option(name: string) {
  const i = args.indexOf(name);
  if (i < 0) return;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing value for ' + name);
  return args[i + 1];
}
const goal =
  'Use only the desktop_probe MCP screenshot, click and type tools. First inspect the screenshot. Read the one-time confirmation code displayed in the card, enter that exact code in the Confirmation code field, then click Verify. Inspect another screenshot after typing because the buttons may move, and inspect the final screenshot to verify success. Do not infer success from an input-delivered acknowledgement. Do not use shell, filesystem, DOM, browser, other MCP tools, or external services. Report what the final screen says.';
const definition = `---
name: desktop-probe
description: Bounded visual test in one disposable window.
tools: [mcp__desktop_probe__*]
disallowed_tools: [Agent, Task]
agents_md: false
discover_skills: false
inherit_skills: false
inject_default_tools: false
max_turns: 12
---
You are attempting a visual desktop task using only one disposable test window.
Use search_tool to discover desktop_probe, then use_tool to call its screenshot, click and type tools.
The screenshot is your only source of UI state. Click coordinates are pixels from the top-left of the 900 by 600 image.
Tool acknowledgements do not describe UI state. Observe screenshots to confirm actions and completion.
Do not use any other tools or attempt to inspect the harness implementation.
`;

const { scoreTrial: score } = require('./desktop-probe/protocol.cjs');

async function engineTurn(
  cwd: string,
  home: string,
  env: NodeJS.ProcessEnv,
  model: string | undefined,
  onUpdate: (update: Wire) => void,
) {
  const rpc = new EmbeddedRpc(
    embeddedEngine(),
    cwd,
    env,
    env.WB_PROBE_FIXTURE === '1' ? 'auto' : 'oauth',
  );
  const rejected: string[] = [];
  rpc.on('request', (message: Wire) => {
    if (message.method === 'session/request_permission') {
      const trust = message.params?.options?.find((o: Wire) => o.optionId === 'trust');
      if (trust)
        rpc.respond(message.id, { outcome: { outcome: 'selected', optionId: trust.optionId } });
      else {
        rejected.push(String(message.params?.toolCall?.title || 'unknown'));
        rpc.respond(message.id, { outcome: { outcome: 'cancelled' } });
      }
    } else
      rpc.reject(
        message.id,
        -32601,
        'The desktop probe provides no filesystem, terminal or client callbacks.',
      );
  });
  rpc.on('notification', (message: Wire) => {
    if (message.method === 'session/update') onUpdate(message.params.update);
  });
  try {
    const init = await rpc.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { _meta: { 'x.ai/folderTrust': { interactive: true } } },
      clientInfo: { name: 'grok-workbench-desktop-probe', version },
    });
    const auth = init._meta?.defaultAuthMethodId;
    if (['cached_token', 'xai.api_key'].includes(auth))
      await rpc.request('authenticate', { methodId: auth }, 30000);
    const session = await rpc.request('session/new', { cwd, mcpServers: [] }, 45000);
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const response = await rpc.request('_x.ai/mcp/list', { sessionId: session.sessionId });
      const catalog = response.result ?? response;
      assert.deepEqual(
        (catalog.servers || []).map((s: Wire) => s.name),
        ['desktop_probe'],
        'Unexpected MCP source in the isolated probe.',
      );
      if (catalog.sessionMcpResolved === true) {
        ready = true;
        break;
      }
      await pause(250);
    }
    if (!ready)
      throw new Error('The native session did not finish initializing its fixture MCP server.');
    if (model)
      await rpc.request(
        'session/set_config_option',
        { sessionId: session.sessionId, configId: 'model', value: model },
        30000,
      );
    const selected = session.configOptions?.find((c: Wire) => c.id === 'model');
    const result = await rpc.request(
      'session/prompt',
      { sessionId: session.sessionId, prompt: [{ type: 'text', text: goal }] },
      90000,
    );
    return {
      model: model || selected?.currentValue || session.models?.currentModelId || 'unreported',
      engine: init.agentInfo,
      stopReason: result.stopReason,
      rejectedPermissions: rejected,
    };
  } finally {
    rpc.close();
    await rpc.waitForExit();
  }
}

async function fixtureProvider() {
  const evidence: Wire = {
    calls: 0,
    toolNames: [],
    imageReceived: false,
    unexpectedTools: [],
    toolResponses: [],
  };
  const server = createServer(async (req, res) => {
    try {
      if (req.url !== '/v1/chat/completions') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"data":[]}');
        return;
      }
      let raw = '';
      for await (const part of req) {
        raw += part;
        if (raw.length > 4 * 1024 * 1024) throw new Error('Oversized fixture request.');
      }
      const body = JSON.parse(raw);
      evidence.toolResponses.push(
        (body.messages || [])
          .filter((m: Wire) => m.role === 'tool')
          .map((m: Wire) => ({
            contentType: typeof m.content,
            summary: JSON.stringify(m.content)
              .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[image]')
              .slice(0, 1800),
          })),
      );
      const names = (body.tools || []).map((t: Wire) => t.function?.name || t.name);
      evidence.toolNames = [...new Set([...evidence.toolNames, ...names])];
      evidence.unexpectedTools = evidence.toolNames.filter(
        (name: string) => !['search_tool', 'use_tool'].includes(name),
      );
      evidence.imageReceived ||=
        /"type":"(?:image_url|input_image|image)"/.test(raw) &&
        raw.includes('data:image/png;base64,');
      const index = evidence.calls++;
      const call =
        index === 0
          ? {
              name: 'search_tool',
              arguments: JSON.stringify({ query: 'desktop_probe screenshot', limit: 3 }),
            }
          : index === 1
            ? {
                name: 'use_tool',
                arguments: JSON.stringify({
                  tool_name: 'desktop_probe__screenshot',
                  tool_input: {},
                }),
              }
            : undefined;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const delta = call
        ? {
            role: 'assistant',
            tool_calls: [{ index: 0, id: 'probe-' + index, type: 'function', function: call }],
          }
        : { role: 'assistant', content: 'FIXTURE_TRANSPORT_CHECK_ONLY' };
      for (const choice of [
        { delta, finish_reason: null },
        { delta: {}, finish_reason: call ? 'tool_calls' : 'stop' },
      ])
        res.write(
          'data: ' +
            JSON.stringify({
              id: 'fixture',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'probe-fixture',
              choices: [{ index: 0, ...choice }],
            }) +
            '\n\n',
        );
      res.end('data: [DONE]\n\n');
    } catch {
      res.writeHead(400);
      res.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return {
    evidence,
    url: `http://127.0.0.1:${(server.address() as any).port}/v1`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

async function main() {
  if (!args.includes('--run') && !args.includes('--self-test')) {
    console.log(
      'Desktop-use experiment (not a product feature).\nFixture only: npm run test:desktop-use:fixture\nLive (uses model quota): npm run test:desktop-use -- --run --home "path/to/Workbench/grok" [--model advertised-id] [--trials 1..3]\nOnly the disposable 900x600 window is captured/controlled. No real desktop access is provided.',
    );
    return;
  }
  const live = args.includes('--run');
  assert.ok(!(live && args.includes('--self-test')), 'Choose fixture or live, not both.');
  const sourceHome = option('--home');
  if (live && !sourceHome)
    throw new Error('--home must explicitly select the existing Workbench Grok OAuth profile.');
  const trials = Number(option('--trials') || '3');
  if (!Number.isInteger(trials) || trials < 1 || trials > 3)
    throw new Error('--trials must be 1..3.');
  await mkdir('.test-data', { recursive: true });
  const output = await mkdtemp(resolve('.test-data/desktop-probe-'));
  const isolated = await mkdtemp(join(tmpdir(), 'grok-desktop-probe-'));
  const cwd = join(isolated, 'workspace'),
    home = join(isolated, 'grok');
  for (const path of [cwd, home, join(isolated, 'electron')]) await mkdir(path);
  const token = randomBytes(32).toString('hex');
  const report: Wire = {
    format: 1,
    experiment: 'visual-window-control',
    mode: live ? 'live-model' : 'fixture-only',
    appVersion: version,
    source: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
    probeFiles: Object.fromEntries(
      await Promise.all(
        [
          'scripts/desktop-use-probe.ts',
          'scripts/desktop-probe/protocol.cjs',
          'scripts/desktop-probe/mcp.cjs',
          'scripts/desktop-probe/window.cjs',
        ].map(async (file) => [
          file,
          createHash('sha256')
            .update(await readFile(file))
            .digest('hex'),
        ]),
      ),
    ),
    startedAt: new Date().toISOString(),
    native: JSON.parse(await readFile('.runtime/engine.json', 'utf8')),
    scope:
      'Only the disposable Electron window. No OS-wide input/capture, DOM tools, files, shell or personal desktop.',
    status: 'running',
    trials: [],
    limitations: [
      'A small Chromium-window task does not establish general OS desktop competence.',
      'Fixture success provides no evidence of Grok capability.',
    ],
  };
  let app: ElectronApplication | undefined, mcp: RpcProcess | undefined;
  const save = () => writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  try {
    app = await electron.launch({
      args: [resolve('scripts/desktop-probe/window.cjs')],
      env: {
        ...process.env,
        WB_DESKTOP_PROBE_TOKEN: token,
        WB_DESKTOP_PROBE_OUTPUT: output,
        WB_DESKTOP_PROBE_USER_DATA: join(isolated, 'electron'),
      },
      timeout: 30000,
    });
    await app.firstWindow();
    let endpoint: string | undefined;
    for (let i = 0; i < 100 && !endpoint; i++) {
      endpoint = await app.evaluate(() => (globalThis as any).desktopProbe?.endpoint);
      if (!endpoint) await pause(50);
    }
    if (!endpoint) throw new Error('Disposable test broker failed to start.');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GROK_HOME: home,
      GROK_CONFIG: '',
      GROK_CONFIG_PATH: '',
      XAI_API_KEY: '',
      GROK_CODE_XAI_API_KEY: '',
      GROK_DEPLOYMENT_KEY: '',
      GROK_SUBAGENTS: '0',
      GROK_MANAGED_MCPS_ENABLED: '0',
      GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED: '0',
      WB_DESKTOP_PROBE_TOKEN: token,
      WB_DESKTOP_PROBE_ENDPOINT: endpoint,
    };
    await writeFile(join(home, 'probe.md'), definition);
    const config = `[agent]\ndefinition=${JSON.stringify(join(home, 'probe.md'))}\n[session]\nload_envrc=false\n[permission]\nallow=["MCPTool(*)"]\n[mcp_servers.desktop_probe]\ncommand=${JSON.stringify(process.execPath)}\nargs=${JSON.stringify([resolve('scripts/desktop-probe/mcp.cjs')])}\n[mcp_servers.desktop_probe.env]\nWB_DESKTOP_PROBE_ENDPOINT=${JSON.stringify(endpoint)}\nWB_DESKTOP_PROBE_TOKEN=${JSON.stringify(token)}\n`;
    await writeFile(join(home, 'config.toml'), config);
    mcp = new RpcProcess(process.execPath, [resolve('scripts/desktop-probe/mcp.cjs')], cwd, env);
    await mcp.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'probe-self-test', version: '1' },
    });
    mcp.notify('notifications/initialized', {});
    const inventory = await mcp.request('tools/list');
    assert.deepEqual(
      inventory.tools.map((t: Wire) => t.name),
      ['screenshot', 'click', 'type'],
    );
    const invoke = async (name: string, input: Wire = {}) => {
      const result = await mcp!.request('tools/call', { name, arguments: input }, 10000);
      assert.ok(!result.isError, 'Fixture action failed.');
      return result;
    };
    if (!live) {
      for (let i = 1; i <= trials; i++) {
        await app.evaluate(
          (_electron, input) => (globalThis as any).desktopProbe.reset(input.index, input.shift),
          { index: i, shift: i === trials },
        );
        const screen = await invoke('screenshot');
        assert.equal(screen.content[1].type, 'image');
        let state = await app.evaluate(() => (globalThis as any).desktopProbe.inspect());
        await invoke('click', state.evaluation.input);
        await invoke('type', { text: String(state.code) });
        await invoke('screenshot');
        state = await app.evaluate(() => (globalThis as any).desktopProbe.inspect());
        await invoke('click', state.evaluation.verify);
        await invoke('screenshot');
        const trial = await app.evaluate(() => (globalThis as any).desktopProbe.finish());
        report.trials.push({ ...score(trial), index: i, actions: trial.actions, scripted: true });
        assert.equal(report.trials.at(-1).passed, true);
      }
    }
    // Check the actual native engine's tool isolation and MCP image delivery with a local mock provider first.
    await app.evaluate(() => (globalThis as any).desktopProbe.reset(0, false));
    const fixture = await fixtureProvider();
    try {
      await writeFile(
        join(home, 'config.toml'),
        config +
          `\n[models]\ndefault="probe-fixture"\n[model.probe-fixture]\nmodel="probe-fixture"\nname="Probe fixture"\nbase_url=${JSON.stringify(fixture.url)}\nbackend="chat_completions"\nenv_key="WB_PROBE_KEY"\ncontext_window=128000\n`,
      );
      await engineTurn(
        cwd,
        home,
        { ...env, WB_PROBE_FIXTURE: '1', WB_PROBE_KEY: 'local-fixture-only' },
        undefined,
        () => {},
      );
      report.transportCheck = { ...fixture.evidence, modelSimulated: true, passed: false };
      assert.ok(
        fixture.evidence.toolNames.includes('use_tool'),
        'Native engine did not advertise MCP dispatch.',
      );
      assert.deepEqual(
        fixture.evidence.unexpectedTools,
        [],
        'Native tool isolation failed; do not run live.',
      );
      assert.equal(
        fixture.evidence.imageReceived,
        true,
        'Native engine did not deliver the PNG to the model endpoint.',
      );
      report.transportCheck = { ...fixture.evidence, modelSimulated: true, passed: true };
    } finally {
      await fixture.close();
    }
    await writeFile(join(home, 'config.toml'), config);
    if (live) {
      await copyFile(join(resolve(sourceHome!), 'auth.json'), join(home, 'auth.json'));
      for (let i = 1; i <= trials; i++) {
        await app.evaluate(
          (_electron, input) => (globalThis as any).desktopProbe.reset(input.index, input.shift),
          { index: i, shift: i === trials },
        );
        const updates: Wire[] = [];
        const turn = await engineTurn(cwd, home, env, option('--model'), (u) => {
          if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text')
            updates.push({ text: String(u.content.text).slice(0, 3000) });
        });
        const trial = await app.evaluate(() => (globalThis as any).desktopProbe.finish());
        report.trials.push({
          ...score(trial),
          index: i,
          ...turn,
          actions: trial.actions,
          response: updates,
          scripted: false,
        });
        await save();
        console.log(
          `LIVE_TRIAL ${i}: ${report.trials.at(-1).passed ? 'pass' : 'fail'} (${turn.model})`,
        );
      }
    }
    report.status = report.trials.every((t: Wire) => t.passed)
      ? live
        ? 'model-pass'
        : 'fixture-pass'
      : 'model-fail';
  } catch (error) {
    report.status = 'blocked';
    report.error = String((error as Error).message).slice(0, 1200);
    report.fixtureErrors = await app
      ?.evaluate(() => (globalThis as any).desktopProbe?.errors)
      .catch(() => undefined);
    process.exitCode = 1;
  } finally {
    mcp?.close();
    await mcp?.waitForExit().catch(() => {});
    await app?.close().catch(() => {});
    try {
      // This exact task-owned directory can contain refreshed/migrated auth files.
      // Verify the absolute target and never follow a replacement directory link.
      assert.equal(dirname(resolve(isolated)), resolve(tmpdir()));
      assert.ok(basename(isolated).startsWith('grok-desktop-probe-'));
      assert.equal((await lstat(isolated)).isSymbolicLink(), false);
      assert.equal((await realpath(isolated)).toLowerCase(), resolve(isolated).toLowerCase());
      await rm(isolated, { recursive: true, force: true });
      report.temporaryProfileRemoved = true;
    } catch {
      report.temporaryProfileRemoved = false;
      report.cleanupRequired = isolated;
      report.status = 'blocked';
      process.exitCode = 1;
    }
    report.completedAt = new Date().toISOString();
    await save();
  }
  console.log(`DESKTOP_PROBE ${report.status}: ${join(output, 'report.json')}`);
  if (report.status === 'model-fail') process.exitCode = 2;
}
main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
