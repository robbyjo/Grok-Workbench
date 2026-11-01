import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

// Local, disposable fixtures only. No provider requests or personal profiles.
if (process.platform !== 'linux') throw new Error('This fixture covers Linux only.');
await mkdir(resolve('.test-data'), { recursive: true });
const mode = process.env.GROK_DESKTOP_TEST_EXE ? 'packaged' : 'source';
const data = await mkdtemp(resolve('.test-data/platform-smoke-'));
const project = join(data, 'project');
await mkdir(project);
const git = (...args) => execFileSync('git', args, { cwd: project, encoding: 'utf8' });
git('init', '-b', 'main');
git('config', 'user.name', 'Platform fixture');
git('config', 'user.email', 'fixture@example.invalid');
await writeFile(join(project, 'hello.txt'), 'Original fixture\n');
git('add', '.');
git('commit', '-m', 'Initial disposable fixture');
await writeFile(join(project, 'hello.txt'), 'Filesystem fixture edit\n');
const now = new Date().toISOString();
await writeFile(
  join(data, 'state.json'),
  JSON.stringify({
    version: 1,
    projects: [{ id: 'p', name: 'Linux platform fixture', path: project }],
    settings: { executable: 'embedded', authMode: 'oauth' },
    threads: [
      {
        id: 't',
        projectId: 'p',
        title: 'Platform fixture',
        cwd: project,
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
const checks = [];
let app;
let page;
const errors = [];
const step = async (name, action) => {
  await action();
  checks.push(name);
  console.log('PASS ' + name);
};
const launch = async () => {
  const instance = await electron.launch({
    chromiumSandbox: true,
    ...(process.env.GROK_DESKTOP_TEST_EXE
      ? { executablePath: process.env.GROK_DESKTOP_TEST_EXE }
      : {}),
    args: process.env.GROK_DESKTOP_TEST_EXE ? [] : ['.'],
    cwd: resolve('.'),
    env: {
      ...process.env,
      GROK_DESKTOP_DATA_DIR: data,
      GROK_HOME: join(data, 'grok'),
      XAI_API_KEY: '',
      GROK_CODE_XAI_API_KEY: '',
      GROK_DEPLOYMENT_KEY: '',
    },
    timeout: 45000,
  });
  instance.process().stderr?.on('data', (value) => process.stderr.write(value));
  return instance;
};
try {
  app = await launch();
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await step('Linux desktop launch and isolated renderer', async () => {
    assert.deepEqual(
      await app.evaluate(({ app, BrowserWindow }) => ({
        disabled: app.commandLine.hasSwitch('no-sandbox'),
        rendererSandbox:
          BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox,
      })),
      { disabled: false, rendererSandbox: true },
    );
    await expect(page.getByRole('heading', { name: 'What are we building?' })).toBeVisible();
    await expect(page.getByText('Experimental Linux', { exact: false })).toBeVisible();
    assert.deepEqual(
      await page.evaluate(() => ({
        platform: window.desktop.platform,
        node: typeof window.require,
        process: typeof window.process,
      })),
      { platform: 'linux', node: 'undefined', process: 'undefined' },
    );
  });
  await step('real GUI file edit/save and external refresh', async () => {
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.getByRole('button', { name: 'hello.txt', exact: true }).click();
    await expect(page.locator('.monaco-editor textarea').first()).toBeVisible();
    await page.getByRole('button', { name: 'Use plain text editor', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Edit hello.txt', exact: true });
    await expect(editor).toHaveValue('Filesystem fixture edit\n');
    await editor.fill('Saved through Linux GUI\n');
    await page.getByRole('button', { name: 'Save file', exact: true }).click();
    await expect
      .poll(() => readFile(join(project, 'hello.txt'), 'utf8'))
      .toBe('Saved through Linux GUI\n');
    await writeFile(join(project, 'hello.txt'), 'External watcher fixture\n');
    await expect(editor).toHaveValue('External watcher fixture\n', { timeout: 15000 });
  });
  await step('real GUI Git stage and commit', async () => {
    await page.getByRole('button', { name: /^Changes/ }).click();
    await page.getByRole('button', { name: 'Stage hello.txt', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Unstage hello.txt', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Review staged commit', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Commit message', exact: true })
      .fill('Linux GUI fixture commit');
    await page.getByRole('button', { name: 'Commit staged index', exact: true }).click();
    await expect(page.locator('.git-notice')).toContainText('Committed');
    assert.equal(git('show', 'HEAD:hello.txt'), 'External watcher fixture\n');
  });
  await step('native POSIX PTY output', async () => {
    await page.getByRole('button', { name: 'Toggle terminal', exact: true }).click();
    await expect(page.locator('.xterm')).toBeVisible();
    await page.evaluate(async () => {
      await window.desktop.call('terminal:open', { id: 't' });
      await window.desktop.call('terminal:write', {
        id: 't',
        data: "printf '%s%s\\n' WORKBENCH_LINUX_ PTY_OK\r",
      });
    });
    await expect
      .poll(
        () =>
          page.evaluate(
            async () => (await window.desktop.call('terminal:open', { id: 't' })).buffer,
          ),
        { timeout: 15000 },
      )
      .toContain('WORKBENCH_LINUX_PTY_OK');
    await page.evaluate(() => window.desktop.call('terminal:close', { id: 't' }));
  });
  await step('session-only credentials and insecure-keyring rejection', async () => {
    const status = await page.evaluate(() => window.desktop.call('auth:status'));
    if (!status.encryptedStorage) {
      assert.match(
        await page.evaluate(async () => {
          try {
            await window.desktop.call('auth:save', { key: 'fixture-local-only', remember: true });
            return 'UNEXPECTED';
          } catch (error) {
            return error.message;
          }
        }),
        /Encrypted credential storage is unavailable/,
      );
    }
    const saved = await page.evaluate(() =>
      window.desktop.call('auth:save', { key: 'fixture-local-only', remember: false }),
    );
    assert.equal(saved.session, true);
    assert.equal(saved.saved, false);
    await assert.rejects(access(join(data, 'xai-api-key.bin')));
    await page.evaluate(async () => {
      await window.desktop.call('auth:forget');
      await window.desktop.call('auth:mode', { mode: 'oauth' });
    });
  });
  await step('embedded MCP STDIO handshake and tool discovery', async () => {
    const fixture = resolve('tests/fixtures/mcp.mjs');
    await page.evaluate(
      async ({ command, fixture }) => {
        await window.desktop.call('mcp:add', {
          id: 't',
          name: 'platform-fixture',
          scope: 'user',
          transport: 'stdio',
          command,
          args: [fixture],
          env: [],
        });
      },
      { command: process.execPath, fixture },
    );
    const report = await page.evaluate(() =>
      window.desktop.call('mcp:doctor', { id: 't', name: 'platform-fixture' }),
    );
    assert.equal(report.healthy_count, 1, JSON.stringify(report));
    assert.equal(report.failing_count, 0, JSON.stringify(report));
    await page.evaluate(async () => {
      await window.desktop.call('mcp:change', {
        id: 't',
        name: 'platform-fixture',
        scope: 'user',
        operation: 'remove',
      });
      await window.desktop.call('agent:disconnect', { id: 't' });
    });
  });
  await step('experimental platform backend guards', async () => {
    for (const [method, expected] of [
      ['updates:check', 'manual updates'],
      ['storage:prune', 'disabled pending POSIX'],
      ['sandbox:preview', 'only on Windows'],
    ]) {
      const message = await page.evaluate(async (method) => {
        try {
          await window.desktop.call(method, { id: 't' });
          return 'UNEXPECTED';
        } catch (error) {
          return error.message;
        }
      }, method);
      assert.ok(message.includes(expected), message);
    }
  });
  await step('persisted chat and normal shutdown/reopen', async () => {
    await page.getByRole('button', { name: 'Pin chat', exact: true }).click();
    await expect
      .poll(() => page.evaluate(async () => (await window.desktop.call('state')).threads[0].pinned))
      .toBe(true);
    await page.screenshot({ path: join(data, mode + '-desktop.png') });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'What are we building?' })).toBeVisible();
    assert.equal((await page.evaluate(() => window.desktop.call('state'))).threads[0].pinned, true);
  });
  assert.deepEqual(errors, []);
  await app.close();
  app = undefined;
  const result = {
    mode,
    platform: process.platform,
    arch: process.arch,
    executable: process.env.GROK_DESKTOP_TEST_EXE || 'source Electron',
    checks,
    providerRequests: false,
    chromiumSandbox: true,
    realDesktopVolunteerTested: false,
    data,
    passed: true,
  };
  await writeFile(join(data, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('PLATFORM_SMOKE=' + JSON.stringify(result));
} catch (error) {
  await page?.screenshot({ path: join(data, mode + '-failure.png') }).catch(() => {});
  await writeFile(
    join(data, 'result.json'),
    JSON.stringify(
      { mode, passed: false, checks, error: error.stack, rendererErrors: errors, data },
      null,
      2,
    ) + '\n',
  );
  throw error;
} finally {
  if (app) {
    await app
      .evaluate(({ dialog }) => {
        const original = dialog.showMessageBox.bind(dialog);
        dialog.showMessageBox = (...args) =>
          args.at(-1)?.buttons?.includes('Discard drafts and quit')
            ? Promise.resolve({ response: 1 })
            : original(...args);
      })
      .catch(() => {});
    await app.close();
  }
}
