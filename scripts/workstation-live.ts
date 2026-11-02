// Explicit, bounded live Grok acceptance through production IPC/MCP. No personal browser session.
import {
  _electron as electron,
  chromium,
  type ElectronApplication,
  type Browser,
} from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { Practice } from '../electron/practice';
import type { Wire } from '../shared/types';
const homeIndex = process.argv.indexOf('--home');
if (!process.argv.includes('--run') || homeIndex < 0)
  throw new Error('Use --run --home ABSOLUTE_AUTHENTICATED_PROFILE for billable live acceptance.');
const domains = (
  process.argv.includes('--domains')
    ? process.argv[process.argv.indexOf('--domains') + 1]
    : 'office,blender,jmp,krita,shopping,chess'
).split(',');
if (
  !domains.length ||
  domains.some((d) => !['office', 'blender', 'jmp', 'krita', 'shopping', 'chess'].includes(d))
)
  throw new Error('Unknown live application domain.');
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => Promise<any>, check: (v: any) => boolean, ms = 180000) {
  const end = Date.now() + ms;
  let value;
  while (Date.now() < end) {
    value = await fn();
    if (check(value)) return value;
    await pause(200);
  }
  throw new Error('Timed out waiting for application result: ' + JSON.stringify(value));
}
async function main() {
  await mkdir('.test-data', { recursive: true });
  const root = await mkdtemp(resolve('.test-data/workstation-live-'));
  const desktop = join(root, 'profile'),
    home = join(desktop, 'grok'),
    cwd = join(root, 'workspace');
  await mkdir(home, { recursive: true });
  await mkdir(cwd);
  const now = new Date().toISOString();
  await writeFile(
    join(desktop, 'state.json'),
    JSON.stringify({
      version: 1,
      projects: [{ id: 'p', name: 'Workstation live acceptance', path: cwd }],
      settings: { executable: 'embedded', authMode: 'oauth' },
      threads: [
        {
          id: 'test',
          projectId: 'p',
          cwd,
          title: 'Workstation live acceptance',
          status: 'idle',
          archived: false,
          pinned: false,
          createdAt: now,
          updatedAt: now,
          entries: [],
        },
      ],
    }),
  );
  await writeFile(
    join(home, 'workstation.md'),
    '---\nname: workstation-test\ndescription: Bounded application acceptance.\ntools: [mcp__workbench__*]\ndisallowed_tools: [Agent, Task]\nagents_md: false\ndiscover_skills: false\ninherit_skills: false\ninject_default_tools: false\nmax_turns: 22\n---\nUse search_tool to discover workbench tools and use_tool to invoke them. Use only workbench MCP tools. Do not use terminal, filesystem, DOM, browser debugging, other MCP servers or other applications. Desktop observations are the only source of page state. Verify actual native results before reporting success. Shopping is a local practice store without checkout. Chess is an offline puzzle.\n',
  );
  await writeFile(
    join(home, 'config.toml'),
    `[agent]\ndefinition=${JSON.stringify(join(home, 'workstation.md'))}\n[session]\nload_envrc=false\n[permission]\nallow=["MCPTool(*)"]\n`,
  );
  let app: ElectronApplication | undefined, browser: Browser | undefined;
  const practice = new Practice();
  const report: Wire = {
    root,
    startedAt: now,
    checks: [],
    enginePin: '2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8',
  };
  try {
    await copyFile(
      join(resolve(process.argv[homeIndex + 1]), 'auth.json'),
      join(home, 'auth.json'),
    );
    app = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        GROK_DESKTOP_DATA_DIR: desktop,
        GROK_HOME: home,
        XAI_API_KEY: '',
        GROK_CODE_XAI_API_KEY: '',
        GROK_DEPLOYMENT_KEY: '',
        GROK_MANAGED_MCPS_ENABLED: '0',
        GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED: '0',
      },
    });
    const page = await app.firstWindow();
    const call = (method: string, args: Wire = {}) =>
      page.evaluate(({ method, args }) => window.desktop.call(method, { id: 'test', ...args }), {
        method,
        args,
      });
    await call('application:grant', { applications: ['office', 'blender', 'jmp', 'krita'] });
    const prompt = async (text: string) => {
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          call('agent:prompt', { text }),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              void call('agent:cancel').catch(() => {});
              reject(new Error('The live model task reached its ten-minute limit.'));
            }, 600000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    const waitJobs = async (before: number, count: number) =>
      until(
        () => call('application:status'),
        (v) =>
          v.jobs.length >= before + count &&
          v.jobs
            .slice(before)
            .every((j: Wire) => ['failed', 'complete', 'stopped'].includes(j.state)),
      );
    for (const [domain, goal, kind, count] of [
      [
        'office',
        'Create a NEW Word document titled "Grok native Office check" with a short paragraph and a two-column table. Then create a NEW Excel workbook with Item and Cost headers, rows Paper 12 and Ink 28, a SUM formula =SUM(B2:B3) in B4 and a chart. Use office_create. Wait for the first job before starting the second and inspect actual application_jobs results. Report the calculated total.',
        'office',
        2,
      ],
      [
        'blender',
        'Use blender_create to make a NEW scene containing a blue cube named Blue cube at [-1.5,0,1], orange sphere named Orange sphere at [1.5,0,1] and a gray floor plane scaled [5,5,5]. Wait for actual completion and report the .blend and render.',
        'blender',
        1,
      ],
      [
        'jmp',
        'Use jmp_analyze to create a native JMP scatterplot and regression for [[1,3.1],[2,4.9],[3,7.2],[4,8.8],[5,11.1],[6,12.9]]. Wait for completion. Inspect the actual native estimates and independently checked coefficients; report the slope and intercept plus saved graph/data paths.',
        'jmp',
        1,
      ],
    ] as const) {
      if (!domains.includes(domain)) continue;
      const before = (await call('application:status')).jobs.length;
      await prompt(goal);
      const status = await waitJobs(before, count);
      const jobs = status.jobs.slice(before);
      assert.equal(jobs.length, count);
      for (const job of jobs) {
        assert.equal(job.application, kind);
        assert.equal(job.state, 'complete', job.error);
        assert.ok(job.files.length);
      }
      if (domain === 'office')
        assert.equal(jobs[1].result.formulaResults.find((f: Wire) => f.cell === 'B4').value, 40);
      if (domain === 'jmp') assert.equal(jobs[0].result.native.verifiedAgainstIndependentOLS, true);
      report.checks.push({ name: 'live-Grok-' + domain, passed: true, jobs });
    }
    if (domains.includes('krita')) {
      const health = await call('application:health');
      assert.ok(!health.isError, JSON.stringify(health));
      const before = (await call('application:status')).audit.length;
      await prompt(
        'The Krita connection has just passed a read-only health check. Use krita_tools to inspect the schemas for krita_document, krita_draw and krita_preview. No existing-document enumeration is needed for this test. Create exactly one NEW 256x256 document named Grok live art check. Preview its blank canvas, draw a filled orange rectangle from [32,32] of width 192 and height 192 using the native Krita tool, then preview the result. Preserve all other artwork and do not save or overwrite files. Close only this new temporary document with discard_changes=true after verification, restoring the previous document. If a native mutation times out, inspect state and report the unknown outcome without retrying it.',
      );
      const status = await call('application:status');
      const audit = status.audit.slice(before);
      assert.ok(audit.some((a: Wire) => a.tool === 'krita_draw' && a.status === 'completed'));
      assert.ok(audit.some((a: Wire) => a.tool === 'krita_preview' && a.status === 'completed'));
      assert.equal(
        status.kritaDocuments.length,
        0,
        'The test should close only its own temporary Krita document.',
      );
      report.checks.push({
        name: 'live-Grok-Krita',
        passed: true,
        tools: audit.map((a: Wire) => a.tool).filter(Boolean),
      });
    }
    if (domains.some((d) => d === 'shopping' || d === 'chess')) {
      await practice.start();
      browser = await chromium.launch({
        channel: 'chrome',
        headless: false,
        args: ['--force-device-scale-factor=1'],
      });
      const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
      const web = await context.newPage();
      await web.goto(practice.url);
      await web.waitForSelector('#add');
      await web.bringToFront();
      const windows = await call('desktop:windows');
      const choices = windows.filter((w: Wire) =>
        w.title.includes('Workbench application practice'),
      );
      assert.equal(choices.length, 1, 'Expected exactly one private practice browser window.');
      await call('desktop:enable', { target: choices[0].id });
      if (domains.includes('shopping')) {
        await prompt(
          'Use only desktop_view/desktop_act to inspect the selected local shopping-practice browser. Filter to Blue products, find the in-stock blue FOUNTAIN pen, add exactly two to the cart, and review it. Read the actual price, shipping and tax, then use shopping_plan to verify the total against a USD 60 budget. Inspect a final screenshot. Do not place an order; this fixture has no checkout.',
        );
        assert.equal(practice.state().cart, 2);
        assert.equal(practice.state().total, 55.7);
        const status = await call('application:status');
        assert.ok(
          status.audit.some((a: Wire) => a.name === 'shopping_plan' && a.status === 'completed'),
        );
        report.checks.push({
          name: 'live-Grok-shopping-browser',
          passed: true,
          state: practice.state(),
        });
        await web.screenshot({ path: join(root, 'shopping.png') });
      }
      if (domains.includes('chess')) {
        await prompt(
          'In the selected practice browser, open Chess practice. Read the CURRENT FEN from the screen and use chess_position to verify it and find the mating move for Black. Then use desktop_act DRAG with a 600ms path to move the queen on the actual board, not merely calculate it. Inspect a fresh screenshot to verify CHECKMATE. This is an offline untimed puzzle. Do not use DOM, browser debugging, or filesystem tools.',
        );
        assert.equal(practice.state().checkmate, true);
        assert.deepEqual(practice.state().moves, ['Qh4#']);
        report.checks.push({
          name: 'live-Grok-chess-browser',
          passed: true,
          state: practice.state(),
        });
        await web.screenshot({ path: join(root, 'chess.png') });
      }
      await call('desktop:stop');
    }
    await page.getByRole('button', { name: /^Desktop & read aloud/ }).click();
    await page.getByText('Office, shopping, art, science & chess', { exact: true }).click();
    await page.screenshot({ path: join(root, 'workstation-panel.png') });
    report.passed = true;
  } catch (e) {
    report.error = (e as Error).stack;
    throw e;
  } finally {
    await browser?.close().catch(() => {});
    practice.close();
    await app?.close().catch(() => {});
    await rm(home, { recursive: true, force: true });
    await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(
      JSON.stringify(
        {
          report: join(root, 'report.json'),
          passed: report.passed,
          checks: report.checks.map((c: Wire) => ({ name: c.name, passed: c.passed })),
        },
        null,
        2,
      ) + '\n',
    );
  }
}
void main().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exitCode = 1;
});
