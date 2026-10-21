import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

test('appearance updates open surfaces independently, validates settings, and survives restart', async () => {
  await mkdir('.test-data', { recursive: true });
  const data = await mkdtemp(resolve('.test-data/appearance-'));
  const project = join(data, 'project');
  await mkdir(project);
  await writeFile(join(project, 'example.ts'), 'const answer = 42;\n');
  const now = new Date().toISOString();
  await writeFile(
    join(data, 'state.json'),
    JSON.stringify({
      version: 1,
      projects: [{ id: 'p', name: 'Appearance fixture', path: project }],
      settings: { executable: resolve('.runtime/grok.exe') },
      threads: [
        {
          id: 't',
          projectId: 'p',
          cwd: project,
          title: 'Readable chat',
          status: 'idle',
          createdAt: now,
          updatedAt: now,
          entries: [
            {
              id: 'a',
              type: 'assistant',
              text: 'Readable log sample\n\n```ts\nconst answer = 42;\n```',
            },
            {
              id: 'tool',
              type: 'tool',
              text: 'Example output',
              data: { rawOutput: 'Log output sample', status: 'completed' },
            },
          ],
        },
      ],
    }),
  );
  const launch = () =>
    electron.launch({
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
    });
  let app: ElectronApplication | undefined;
  try {
    app = await launch();
    let page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('.markdown').first()).toContainText('Readable log sample');
    await page.getByRole('button', { name: 'Toggle terminal', exact: true }).click();
    await expect(page.locator('.xterm')).toBeVisible();
    // The terminal surface can mount before PowerShell finishes initializing.
    // Wait for the prompt, then confirm the assignment executed before changing appearance.
    await expect
      .poll(
        () =>
          page.evaluate(
            async () => (await window.desktop.call('terminal:open', { id: 't' })).buffer,
          ),
        { timeout: 30_000 },
      )
      .toMatch(/PS [^\r\n>]+> /);
    await page.evaluate(() =>
      window.desktop.call('terminal:write', {
        id: 't',
        data: "$appearanceMarker = 'PRESERVED'; Write-Output ('APPEARANCE_' + 'READY');\r",
      }),
    );
    await expect
      .poll(
        () =>
          page.evaluate(
            async () => (await window.desktop.call('terminal:open', { id: 't' })).buffer,
          ),
        { timeout: 30_000 },
      )
      .toContain('APPEARANCE_READY');
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.getByRole('button', { name: 'example.ts', exact: true }).click();
    await expect(page.locator('.monaco-editor textarea').first()).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await page.getByLabel('Background theme').selectOption('light');
    await page.getByLabel('UI text size (%)', { exact: true }).fill('125');
    await page.getByLabel('Log and terminal font size (px)', { exact: true }).fill('18');
    await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
    await expect(page.getByText('Appearance saved.', { exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('.settings-button')).toHaveCSS('font-size', '15px');
    await expect(page.locator('.markdown').first()).toHaveCSS('font-size', '18px');
    await expect(page.locator('.activity pre')).toHaveCSS('font-size', '18px');
    await expect(page.locator('.xterm-rows')).toHaveCSS('font-size', '18px');
    await expect(page.locator('.monaco-editor')).toHaveClass(/vs\b/);
    await expect(page.locator('.monaco-editor .view-lines')).toHaveCSS('font-size', '16.25px');
    await page.locator('.settings-modal').evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: '.test-data/appearance-light-settings.png' });
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.evaluate(() =>
      window.desktop.call('terminal:write', {
        id: 't',
        data: "Write-Output ('APPEARANCE_' + $appearanceMarker)\r",
      }),
    );
    await expect
      .poll(
        () =>
          page.evaluate(
            async () => (await window.desktop.call('terminal:open', { id: 't' })).buffer,
          ),
        { timeout: 30_000 },
      )
      .toContain('APPEARANCE_PRESERVED');
    await page.screenshot({ path: '.test-data/appearance-light-workspace.png' });
    // A normal preferences save must retain appearance; invalid IPC must leave it intact.
    await page.evaluate(() => window.desktop.call('preferences:save', { notifications: true }));
    for (const appearance of [
      { theme: 'invalid', uiScale: 125, logFontSize: 18 },
      { theme: 'light', uiScale: 999, logFontSize: 18 },
      { theme: 'light', uiScale: 125, logFontSize: 0 },
    ]) {
      expect(
        await page.evaluate(async (appearance) => {
          try {
            await window.desktop.call('preferences:save', { appearance });
            return false;
          } catch {
            return true;
          }
        }, appearance),
      ).toBe(true);
    }
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('.settings-button')).toHaveCSS('font-size', '15px');
    await expect(page.locator('.markdown').first()).toHaveCSS('font-size', '18px');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await expect(page.getByLabel('Background theme')).toHaveValue('light');
    await page.getByLabel('Background theme').selectOption('dark');
    await page.getByLabel('UI text size (%)', { exact: true }).fill('175');
    await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.settings-button')).toHaveCSS('font-size', '21px');
    await expect(page.locator('.markdown').first()).toHaveCSS('font-size', '18px');
    await page.locator('.settings-modal').evaluate((element) => {
      element.scrollTop = 0;
    });
    expect(
      await page
        .locator('.settings-tabs')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    expect(
      await page
        .getByRole('tabpanel', { name: 'Appearance', exact: true })
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: '.test-data/appearance-dark-large.png' });
    await page.getByRole('button', { name: 'Reset appearance fields', exact: true }).click();
    await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
    await expect(page.locator('.settings-button')).toHaveCSS('font-size', '12px');
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
  }
});
