import { test, expect, _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
test('website describes the Grok Build GUI in search metadata and fits desktop and mobile', async () => {
  await mkdir('.test-data', { recursive: true });
  const root = await mkdtemp(resolve('.test-data/website-gui-'));
  const script = join(root, 'preview.cjs');
  await writeFile(
    script,
    `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(root)});app.whenReady().then(()=>{const w=new BrowserWindow({width:1280,height:900,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});w.loadFile(${JSON.stringify(resolve('website/index.html'))});});app.on('window-all-closed',()=>app.quit());`,
  );
  const app = await electron.launch({ args: [script], cwd: resolve('.') });
  try {
    const page = await app.firstWindow();
    await expect(page).toHaveTitle('Grok Workbench — Grok Build GUI for Windows');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      /Grok Build GUI for Windows/,
    );
    await expect(page.locator('h1')).toContainText('Grok Build GUI.');
    for (const width of [1280, 390]) {
      await app.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900),
        width,
      );
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await expect(page.locator('.app-screenshot')).toBeVisible();
      expect(
        await page.locator('.app-screenshot').evaluate((e: HTMLImageElement) => e.naturalWidth),
      ).toBeGreaterThan(0);
      await page.screenshot({ path: `.test-data/website-gui-${width}.png`, fullPage: true });
    }
  } finally {
    await app.close();
  }
});
