import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

test('settings categories retain drafts, unlock interrupted selectors and persist new-chat permissions', async () => {
  await mkdir('.test-data', { recursive: true });
  const root = await mkdtemp(resolve('.test-data/settings-'));
  const now = new Date().toISOString();
  await writeFile(
    join(root, 'state.json'),
    JSON.stringify({
      version: 1,
      projects: [{ id: 'p', name: 'Settings fixture', path: root }],
      settings: { executable: 'embedded' },
      threads: [
        {
          id: 't',
          projectId: 'p',
          cwd: root,
          title: 'Interrupted chat',
          status: 'running',
          createdAt: now,
          updatedAt: now,
          entries: [],
          alwaysApprove: false,
          session: {
            configOptions: [
              {
                id: 'model',
                name: 'Model',
                type: 'select',
                currentValue: 'fixture',
                options: [
                  { value: 'fixture', name: 'Fixture' },
                  { value: 'fast', name: 'Fast' },
                ],
              },
              {
                id: 'reasoning_effort',
                name: 'Reasoning Effort',
                type: 'select',
                currentValue: 'high',
                options: [
                  {
                    name: 'Efforts',
                    options: [
                      { value: 'low', name: 'Low' },
                      { value: 'high', name: 'High' },
                    ],
                  },
                ],
              },
            ],
          },
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
        GROK_DESKTOP_DATA_DIR: root,
        GROK_HOME: join(root, 'grok'),
        XAI_API_KEY: '',
        GROK_CODE_XAI_API_KEY: '',
        GROK_DEPLOYMENT_KEY: '',
      },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const composerMode = page
      .locator('.composer')
      .getByRole('combobox', { name: 'Permission mode for this chat', exact: true });
    await expect(composerMode).toHaveValue('ask');
    await expect(composerMode.locator('option')).toHaveText([
      'Always ask',
      'Approve for me',
      'Approve all',
    ]);
    for (const mode of ['auto', 'always-approve', 'ask']) {
      await composerMode.selectOption(mode);
      await expect(composerMode).toHaveValue(mode);
      const current = (await page.evaluate(() => window.desktop.call('state'))).threads.find(
        (t: any) => t.id === 't',
      );
      expect(current.permissionMode).toBe(mode);
      expect(current.alwaysApprove).toBe(mode === 'always-approve');
    }
    expect(
      (await page.evaluate(() => window.desktop.call('diagnostics:info'))).agents.connections,
    ).toBe(0);
    expect(
      await page.evaluate(() =>
        window.desktop.call('permission:set-mode', { id: 't', mode: 'invented' }).then(
          () => '',
          (e) => String(e),
        ),
      ),
    ).toContain('Invalid permission mode');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(dialog.getByRole('tab', { selected: true })).toHaveText('General');
    await dialog.getByRole('tab', { name: 'General', exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(dialog.getByRole('tab', { name: 'Appearance', exact: true })).toBeFocused();
    await dialog.getByLabel('UI text size (%)', { exact: true }).fill('125');
    await page.keyboard.press('Shift+Tab');
    await dialog.getByRole('tab', { name: 'Models & permissions', exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: 'Model', exact: true })).toBeEnabled();
    await expect(
      dialog.getByRole('combobox', { name: 'Reasoning Effort', exact: true }),
    ).toBeEnabled();
    await expect(
      dialog.getByRole('button', { name: 'Connect to refresh model choices' }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('combobox', { name: 'Model', exact: true }).locator('option'),
    ).toHaveText(['Fixture', 'Fast']);
    await expect(
      dialog.getByRole('combobox', { name: 'Reasoning Effort', exact: true }).locator('option'),
    ).toHaveText(['Low', 'High']);
    await dialog.getByLabel('Permission mode for new chats').selectOption('always-approve');
    await dialog.getByRole('button', { name: 'Save default permissions' }).click();
    await expect(dialog.getByRole('status')).toHaveText('Default permissions saved.');
    await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await expect(dialog.getByLabel('UI text size (%)', { exact: true })).toHaveValue('125');
    await dialog.getByRole('tab', { name: 'Keyboard shortcuts', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save desktop preferences', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Desktop preferences saved.');
    const created = await page.evaluate(() =>
      window.desktop.call('thread:new', { projectId: 'p' }),
    );
    expect(created.alwaysApprove).toBe(true);
    expect(
      (await page.evaluate(() => window.desktop.call('state'))).threads.find(
        (t: any) => t.id === 't',
      ).alwaysApprove,
    ).toBe(false);
    expect(
      await page.evaluate(() =>
        window.desktop.call('preferences:save', { defaultPermissionMode: 'invented' }).then(
          () => '',
          (e) => String(e),
        ),
      ),
    ).toContain('Invalid default permission mode');
    await dialog.getByRole('tab', { name: 'Models & permissions', exact: true }).click();
    await dialog
      .getByRole('combobox', { name: 'Permission mode for this chat', exact: true })
      .selectOption('auto');
    await expect(composerMode).toHaveValue('auto');
    expect(
      (await page.evaluate(() => window.desktop.call('state'))).settings.defaultPermissionMode,
    ).toBe('always-approve');
    await page.screenshot({ path: '.test-data/settings-categories.png' });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    expect(
      (await page.evaluate(() => window.desktop.call('state'))).threads.find(
        (t: any) => t.id === 't',
      ).permissionMode,
    ).toBe('auto');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await dialog.getByRole('tab', { name: 'Models & permissions', exact: true }).click();
    await expect(dialog.getByLabel('Permission mode for new chats')).toHaveValue('always-approve');
    await dialog.getByLabel('Permission mode for new chats').selectOption('ask');
    await dialog.getByRole('button', { name: 'Save default permissions' }).click();
    await expect(dialog.getByRole('status')).toHaveText('Default permissions saved.');
    const asking = await page.evaluate(() => window.desktop.call('thread:new', { projectId: 'p' }));
    expect(asking.alwaysApprove).toBe(false);
    expect(
      (await page.evaluate(() => window.desktop.call('state'))).threads.find(
        (t: any) => t.id === created.id,
      ).alwaysApprove,
    ).toBe(true);
    await dialog.getByLabel('Permission mode for new chats').selectOption('auto');
    await dialog.getByRole('button', { name: 'Save default permissions' }).click();
    await expect(dialog.getByRole('status')).toHaveText('Default permissions saved.');
    const automatic = await page.evaluate(() =>
      window.desktop.call('thread:new', { projectId: 'p' }),
    );
    expect(automatic.permissionMode).toBe('auto');
    expect(automatic.alwaysApprove).toBe(false);
  } finally {
    await app.close();
  }
});
