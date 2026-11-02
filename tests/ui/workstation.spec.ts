import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
test('application tools are opt-in, practice stays local and disconnect revokes grants', async () => {
  await mkdir('.test-data', { recursive: true });
  const root = await mkdtemp(resolve('.test-data/workstation-ui-'));
  const now = new Date().toISOString();
  await writeFile(
    join(root, 'state.json'),
    JSON.stringify({
      version: 1,
      projects: [{ id: 'p', name: 'Application UI', path: root }],
      settings: { executable: 'embedded' },
      threads: [
        {
          id: 't',
          projectId: 'p',
          cwd: root,
          title: 'Application UI',
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
      GROK_CODE_XAI_API_KEY: '',
      GROK_DEPLOYMENT_KEY: '',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: /^Desktop & read aloud/ }).click();
    await page.getByText('Office, shopping, art, science & chess', { exact: true }).click();
    const office = page.getByRole('checkbox', { name: 'Word / Excel' });
    await expect(office).not.toBeChecked();
    await office.check();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.desktop.call('application:status', { id: 't' })).granted,
        ),
      )
      .toContain('office');
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (url) => {
        (globalThis as any).workstationPracticeURL = url;
      };
    });
    await page.getByRole('button', { name: 'Open local shopping / chess practice' }).click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).workstationPracticeURL))
      .toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const actual = await app.evaluate(() => (globalThis as any).workstationPracticeURL);
    const html = await (await fetch(actual)).text();
    expect(html).toContain('no purchases');
    await page
      .getByLabel('Application task starter', { exact: true })
      .selectOption({ label: 'JMP' });
    await expect(page.getByLabel('Application task', { exact: true })).toHaveValue(/jmp_analyze/);
    await page.evaluate(() => window.desktop.call('agent:disconnect', { id: 't' }));
    await expect(office).not.toBeChecked();
  } finally {
    await app.close();
  }
});
