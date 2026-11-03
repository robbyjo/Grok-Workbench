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
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page).toHaveTitle('Grok Workbench — Grok Build GUI for Windows, Linux and macOS');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      /Grok Build GUI for Windows/,
    );
    await expect(page.locator('h1')).toContainText('Grok Build GUI.');
    await expect(page.locator('.release-highlight')).toContainText('New in v0.9.0');
    await expect(page.getByRole('link', { name: 'Explore desktop use' })).toHaveAttribute(
      'href',
      '#desktop-use',
    );
    await expect(
      page.getByRole('heading', { name: 'Put Grok to work across your desktop.' }),
    ).toBeVisible();
    expect(
      await page
        .locator('#desktop-use')
        .evaluate((el) =>
          Boolean(
            el.compareDocumentPosition(document.querySelector('#downloads')!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        ),
    ).toBe(true);
    await expect(page.locator('.desktop-examples')).toContainText('Word, Excel and PowerPoint');
    await expect(page.locator('.desktop-validation')).toContainText('bounded demonstrations');
    await expect(page.locator('.desktop-screenshot img')).toHaveCount(5);
    await expect(page.locator('.download-card')).toHaveCount(3);
    await expect(
      page.getByRole('link', { name: 'Download Windows x64', exact: true }),
    ).toHaveAttribute('href', /v0\.9\.0\/Grok-Workbench-0\.9\.0-Portable\.exe$/);
    await expect(
      page.getByRole('link', { name: 'Download Ubuntu .deb', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.mac-download')).toContainText('UNTESTED');
    await expect(
      page.getByRole('link', { name: 'Apple Silicon (UNTESTED)', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /Intel Mac \(UNTESTED\)/ })).toBeVisible();
    for (const width of [1280, 390]) {
      await app.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 900),
        width,
      );
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      for (const img of await page.locator('.desktop-screenshot img, .app-screenshot').all()) {
        await img.scrollIntoViewIfNeeded();
        await expect
          .poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth))
          .toBeGreaterThan(0);
        const link = img.locator('..');
        await expect(link).toHaveAttribute('href', (await img.getAttribute('src')) as string);
      }
      await page
        .locator('.desktop-spotlight')
        .screenshot({ path: `.test-data/website-desktop-use-${width}.png` });
      await page
        .locator('.desktop-examples')
        .screenshot({ path: `.test-data/website-desktop-examples-${width}.png` });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `.test-data/website-hero-${width}.png` });
      await page.screenshot({ path: `.test-data/website-gui-${width}.png`, fullPage: true });
    }
    await page.getByRole('combobox', { name: 'Color theme' }).selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page
      .locator('.desktop-spotlight')
      .screenshot({ path: '.test-data/website-desktop-use-dark.png' });
  } finally {
    await app.close();
  }
});
