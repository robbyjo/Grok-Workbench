import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

test('workflow improvements: disk reconciliation, per-turn review, unread persistence, screenshot paste, file drop and questions', async () => {
  test.setTimeout(120000);
  await mkdir('.test-data', { recursive: true });
  const root = await mkdtemp(resolve('.test-data/improvements-'));
  const cwd = join(root, 'project');
  await mkdir(cwd);
  const git = (args: string[]) => execFileSync('git', args, { cwd, windowsHide: true });
  git(['init']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  await writeFile(join(cwd, 'hello.txt'), 'initial\n');
  git(['add', '.']);
  git(['commit', '-m', 'baseline']);
  const now = new Date().toISOString();
  await writeFile(
    join(root, 'state.json'),
    JSON.stringify({
      version: 1,
      projects: [{ id: 'p', name: 'Workflow fixture', path: cwd }],
      settings: { executable: resolve('.runtime/grok.exe') },
      threads: [
        {
          id: 't',
          projectId: 'p',
          title: 'Workflow chat',
          cwd,
          status: 'idle',
          archived: false,
          pinned: false,
          createdAt: now,
          updatedAt: now,
          readState: { revision: 'receipt-1', firstUnread: 'finished' },
          entries: [
            {
              id: 'edit',
              turn: 'seed-turn',
              type: 'tool',
              text: 'Edit fixture',
              data: {
                status: 'completed',
                toolCallId: 'edit-tool',
                content: [
                  {
                    type: 'diff',
                    path: 'hello.txt',
                    oldText: 'before agent\n',
                    newText: 'after agent\n',
                  },
                ],
              },
            },
            { id: 'finished', turn: 'seed-turn', type: 'notice', text: 'Turn finished' },
          ],
        },
      ],
    }),
  );
  const app = await electron.launch({
    ...(process.env.GROK_DESKTOP_TEST_EXE
      ? { executablePath: process.env.GROK_DESKTOP_TEST_EXE }
      : {}),
    args: process.env.GROK_DESKTOP_TEST_EXE ? [] : ['.'],
    cwd: resolve('.'),
    env: {
      ...process.env,
      GROK_DESKTOP_DATA_DIR: root,
      GROK_HOME: join(root, 'grok'),
      XAI_API_KEY: '',
      GROK_DEPLOYMENT_KEY: '',
    },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByLabel('Unread result')).toBeVisible();
    await page.getByText('Changes from this turn', { exact: true }).click();
    await expect(page.locator('.turn-edit-versions')).toContainText('before agent');
    await expect(page.locator('.turn-edit-versions')).toContainText('after agent');
    await page.getByRole('button', { name: 'First unread result', exact: true }).click();
    await expect(page.locator('[data-entry-id="finished"]')).toBeFocused();
    await page.getByRole('button', { name: 'Mark read', exact: true }).click();
    await expect(page.getByLabel('Unread result')).toHaveCount(0);
    await page.getByRole('button', { name: 'Mark unread', exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].reload());
    await expect(page.getByLabel('Unread result')).toBeVisible();
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.getByRole('button', { name: 'Changes', exact: true }).click();
    await writeFile(join(cwd, 'hello.txt'), 'automatic Git refresh\n');
    await expect(page.locator('.diff-view').first()).toContainText('automatic Git refresh');
    await writeFile(join(cwd, 'hello.txt'), 'initial\n');
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.getByRole('button', { name: 'hello.txt', exact: true }).click();
    await expect(page.locator('.monaco-editor textarea').first()).toBeVisible();
    await page.getByRole('button', { name: 'Use plain text editor', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Edit hello.txt', exact: true });
    await expect(editor).toHaveValue('initial\n');
    await writeFile(join(cwd, 'hello.txt'), 'external change\n');
    await expect(editor).toHaveValue('external change\n');
    await editor.fill('preserved draft\n');
    await writeFile(join(cwd, 'hello.txt'), 'another writer\n');
    await expect(page.locator('.file-editor .panel-error')).toContainText('File changed on disk');
    await expect(editor).toHaveValue('preserved draft\n');
    await page.getByText('Compare disk change with draft', { exact: true }).click();
    await expect(page.locator('.disk-comparison')).toContainText('another writer');
    // A native clipboard write exercises Electron's actual asynchronous clipboard API.
    await app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const previous = await clipboard.read();
      (globalThis as any).workflowClipboard = await Promise.all(
        previous
          .filter((item) => item.types.length > 0)
          .map(
            async (item) =>
              new ClipboardItem(
                Object.fromEntries(
                  await Promise.all(
                    item.types.map(async (type) => [type, await item.getType(type)]),
                  ),
                ),
              ),
          ),
      );
      const png = nativeImage
        .createFromBitmap(Buffer.alloc(16 * 16 * 4, 255), { width: 16, height: 16 })
        .toPNG();
      (globalThis as any).workflowClipboardImage = png;
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png]) })]);
      if (!(await clipboard.has('image/png')))
        throw new Error('Fixture clipboard image was not written.');
    });
    const composer = page.getByRole('textbox', { name: 'Message Grok', exact: true });
    await composer.focus();
    await composer.press('Control+V');
    await expect(page.locator('.attachments')).toContainText('Screenshot-');
    // Back the File with a real OS path, as with an Explorer drop.
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'drop-fixture';
      document.body.appendChild(input);
    });
    await page.locator('#drop-fixture').setInputFiles(join(cwd, 'hello.txt'));
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('#drop-fixture')!;
      const data = new DataTransfer();
      data.items.add(input.files![0]);
      document
        .querySelector('.composer')!
        .dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }),
        );
      input.remove();
    });
    await expect(page.locator('.attachments')).toContainText('hello.txt');
    await expect
      .poll(() =>
        page.evaluate(async () => (await window.desktop.call('drafts:get')).attachments.t?.length),
      )
      .toBe(2);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].reload());
    await expect(page.locator('.attachments')).toContainText('Screenshot-');
    await expect(page.locator('.attachments')).toContainText('hello.txt');
    // Only the engine process is replaced by a protocol fixture. Production IPC and UI stay intact.
    await app.evaluate(({ app }, fixture) => {
      const load = (process as any).mainModule.require.bind((process as any).mainModule);
      const { Agents } = load(app.getAppPath() + '/dist-electron/electron/agent.js');
      const { RpcProcess } = load(app.getAppPath() + '/dist-electron/electron/rpc.js');
      const original = Agents.prototype.questionsSnapshot;
      Agents.prototype.questionsSnapshot = function () {
        this.launch = (cwd: string) =>
          new RpcProcess(process.execPath, [fixture, 'questions'], cwd, {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
          });
        return original.call(this);
      };
    }, resolve('tests/fixtures/agent.mjs'));
    await page.evaluate(() => window.desktop.call('questions'));
    await page.evaluate(() => {
      void window.desktop.call('agent:prompt', {
        id: 't',
        text: 'Ask a question',
        attachments: [],
      });
    });
    await expect(page.getByRole('region', { name: 'Grok questions' })).toBeVisible();
    await page.screenshot({ path: '.test-data/workflow-questions.png' });
    await page.getByRole('radio', { name: /Local/ }).check();
    await page.getByRole('textbox', { name: 'Answer: Any details?' }).fill('Retain local work');
    await page.getByRole('button', { name: 'Send answers', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Grok questions' })).toHaveCount(0);
    await expect(page.locator('.message.assistant').last()).toContainText('Retain local work');
    await page.screenshot({ path: '.test-data/workflow-improvements.png' });
    await page.evaluate(() => window.desktop.call('drafts:save', { value: {} }));
    await page.evaluate(() => window.desktop.call('editor:dirty', { count: 0 }));
  } finally {
    await app
      .evaluate(async ({ clipboard }) => {
        const previous = (globalThis as any).workflowClipboard;
        const expected = (globalThis as any).workflowClipboardImage;
        const item = (await clipboard.read()).find((i) => i.types.includes('image/png'));
        // Do not overwrite a new clipboard value copied by the user during the test.
        if (!previous || !expected || !item) return;
        const current = Buffer.from(await (await item.getType('image/png')).arrayBuffer());
        if (!current.equals(expected)) return;
        if (previous.length) await clipboard.write(previous);
        else clipboard.clear();
      })
      .catch(() => {});
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  }
});
