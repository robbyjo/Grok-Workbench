import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

test('update options remain separate and readable at normal and enlarged text sizes', async () => {
  await mkdir('.test-data', { recursive: true });
  const root = await mkdtemp(resolve('.test-data/updates-layout-'));
  await writeFile(
    join(root, 'state.json'),
    JSON.stringify({
      version: 1,
      projects: [{ id: 'p', name: 'Updates layout', path: root }],
      threads: [],
      settings: { executable: 'embedded' },
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
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 800));
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    for (const [theme, scale] of [
      ['dark', '100'],
      ['light', '175'],
    ]) {
      await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
      await page.getByLabel('Background theme').selectOption(theme);
      await page.getByLabel('UI text size (%)', { exact: true }).fill(scale);
      await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
      await expect(page.getByText('Appearance saved.', { exact: true })).toBeVisible();
      await page.getByRole('tab', { name: 'Updates', exact: true }).click();
      const panel = page.getByRole('tabpanel', { name: 'Updates', exact: true });
      await expect(
        panel.getByRole('heading', { name: 'Current installation', exact: true }),
      ).toBeVisible();
      await expect(panel.getByRole('heading', { name: 'Find updates', exact: true })).toBeVisible();
      const options = panel.getByRole('region', { name: 'Installation options', exact: true });
      await options.scrollIntoViewIfNeeded();
      const unsigned = options.getByRole('checkbox', {
        name: 'Allow unsigned updates from the project’s GitHub releases',
        exact: true,
      });
      const migration = options.getByRole('checkbox', {
        name: 'Allow a reviewed engine change with unchanged native formats',
        exact: true,
      });
      await unsigned.check();
      await expect(unsigned).toBeChecked();
      await unsigned.uncheck();
      await migration.check();
      await expect(migration).toBeChecked();
      await migration.uncheck();
      const rows = await options.locator('label').evaluateAll((elements) =>
        elements.map((element) => {
          const { top, bottom } = element.getBoundingClientRect();
          return { top, bottom };
        }),
      );
      expect(rows[1].top - rows[0].bottom).toBeGreaterThanOrEqual(10);
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await panel.evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.screenshot({ path: `.test-data/updates-${theme}-${scale}.png` });
      await panel
        .getByRole('button', { name: 'Inspect installed version and rollback', exact: true })
        .click();
      await expect(panel.locator('pre')).toBeVisible();
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }
  } finally {
    await app.close();
  }
});
