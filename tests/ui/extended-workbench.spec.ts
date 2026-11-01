import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { zipSync, strToU8 } from 'fflate';
function pdf() {
  const stream = 'BT /F1 24 Tf 30 100 Td (LOCAL PDF PREVIEW) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n',
    offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const start = out.length;
  out += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, '0') + ' 00000 n ')
    .join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return out;
}
test(
  'extended workbench: native scheduled provider turn, mobile pairing, document rendering and remembered localization',
  { timeout: 180000 },
  async () => {
    await mkdir('.test-data', { recursive: true });
    const root = await mkdtemp(resolve('.test-data/extended-')),
      project = join(root, 'project');
    await mkdir(project);
    await writeFile(join(project, 'sample.pdf'), pdf());
    await writeFile(
      join(project, 'sample.docx'),
      zipSync({
        'word/document.xml': strToU8(
          '<w:document><w:body><w:p><w:r><w:t>OFFICE PREVIEW CONTENT</w:t></w:r></w:p></w:body></w:document>',
        ),
      }),
    );
    let modelCalls = 0;
    const receivedModels: string[] = [];
    const server = createServer(async (req, res) => {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"data":[]}');
        return;
      }
      let raw = '';
      for await (const c of req) raw += c;
      const value = JSON.parse(raw);
      expect(req.headers.authorization).toBe('Bearer local-fixture-only');
      receivedModels.push(value.model);
      if (value.model === 'fixture-routing') modelCalls++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        'data: ' +
          JSON.stringify({
            id: 'fixture',
            object: 'chat.completion.chunk',
            created: 1,
            model: value.model,
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: 'SCHEDULED_PROVIDER_OK' },
                finish_reason: null,
              },
            ],
          }) +
          '\n\n',
      );
      res.write(
        'data: ' +
          JSON.stringify({
            id: 'fixture',
            object: 'chat.completion.chunk',
            created: 1,
            model: value.model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          }) +
          '\n\n',
      );
      res.end('data: [DONE]\n\n');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const now = new Date().toISOString();
    await writeFile(
      join(root, 'state.json'),
      JSON.stringify({
        version: 1,
        projects: [{ id: 'p', name: 'Extended fixture', path: project }],
        settings: { executable: 'embedded' },
        threads: [
          {
            id: 't',
            projectId: 'p',
            cwd: project,
            title: 'Feature fixture',
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
          GROK_CONFIG: '',
          GROK_CONFIG_PATH: '',
          GROK_SUBAGENTS: '0',
        },
      });
    let app = await launch();
    try {
      let page = await app.firstWindow();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.locator('.thread-row').filter({ hasText: 'Feature fixture' }).click();
      // First native account inspection can initialize config.toml. Review its final snapshot.
      await page.evaluate(() => window.desktop.call('auth:account'));
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('tab', { name: 'Providers', exact: true }).click();
      await page.getByLabel('Profile name', { exact: true }).fill('Local fixture');
      await page
        .getByLabel('API base URL', { exact: true })
        .fill(`http://127.0.0.1:${(server.address() as any).port}/v1`);
      await page.getByLabel('Model routing ID', { exact: true }).fill('fixture-routing');
      await page.getByLabel('Provider API key', { exact: true }).fill('local-fixture-only');
      await page.getByLabel('Remember with encrypted storage', { exact: true }).uncheck();
      await page
        .getByRole('button', { name: 'Preview provider configuration', exact: true })
        .click();
      await expect(page.locator('.review-panel pre')).toContainText('env_key');
      await expect(page.locator('.review-panel pre')).not.toContainText('local-fixture-only');
      await page.getByRole('button', { name: 'Save reviewed provider', exact: true }).click();
      await page.screenshot({ path: '.test-data/extended-providers.png' });
      await expect(page.getByText('Session-only key', { exact: true })).toBeVisible();
      const profiles = await page.evaluate(() => window.desktop.call('providers:list'));
      await page.screenshot({ path: '.test-data/extended-providers.png' });
      await page.getByLabel('Provider for this chat', { exact: true }).selectOption(profiles[0].id);
      // A custom profile must not depend on decrypting an unrelated first-party API key.
      await writeFile(join(root, 'xai-api-key.bin'), Buffer.from('invalid-unrelated-fixture'));
      await page.getByRole('tab', { name: 'Automations & PR watches', exact: true }).click();
      await page.getByLabel('Name', { exact: true }).fill('Paused UI task');
      await page.getByLabel('Prompt', { exact: true }).fill('Review project');
      await page.getByRole('button', { name: 'Save automation', exact: true }).click();
      await expect(page.getByText('Paused UI task', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
      await page.screenshot({ path: '.test-data/extended-automations.png' });
      await page.evaluate(async (providerId) => {
        await window.desktop.call('background:save', {
          name: 'Native scheduled fixture',
          projectId: 'p',
          threadId: 't',
          prompt: 'Reply with the fixture marker. Do not use tools.',
          enabled: true,
          schedule: { kind: 'once', at: new Date(Date.now() + 2000).toISOString() },
        });
      }, profiles[0].id);
      await expect
        .poll(
          () =>
            page.evaluate(async () => {
              await window.desktop.call('background:check');
              return (await window.desktop.call('background:list')).runs.filter(
                (r: any) => r.status === 'completed',
              ).length;
            }),
          { timeout: 60000 },
        )
        .toBe(1);
      expect(modelCalls).toBeGreaterThan(0);
      expect(
        await page.evaluate(
          async () =>
            (await window.desktop.call('history:page', { id: 't' })).entries.filter(
              (e: any) => e.type === 'user',
            ).length,
        ),
      ).toBe(1);
      await page.getByRole('tab', { name: 'Remote access', exact: true }).click();
      await page.getByLabel('Extended fixture', { exact: true }).check();
      await page.getByRole('button', { name: 'Start remote access', exact: true }).click();
      await expect(page.getByText('Remote access is running', { exact: false })).toBeVisible();
      const token = await page.getByLabel('Pairing token', { exact: true }).inputValue();
      const remote = await page.evaluate(() => window.desktop.call('remote:status'));
      await page.evaluate(
        (url) => window.desktop.call('preview:browser', { url }),
        remote.localUrl,
      );
      await expect.poll(() => app.windows().length).toBe(2);
      const mobile = app.windows().find((p) => p !== page)!;
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().startsWith('http://127.0.0.1:'))
          ?.setSize(440, 800),
      );
      await mobile.getByLabel('Pairing token', { exact: true }).fill(token);
      await mobile.getByRole('button', { name: 'Connect', exact: true }).click();
      await expect(mobile.locator('#entries')).toContainText('SCHEDULED_PROVIDER_OK');
      await expect(mobile.locator('#controls')).toBeHidden();
      expect(await mobile.evaluate(() => typeof (window as any).desktop)).toBe('undefined');
      await mobile.screenshot({ path: '.test-data/extended-mobile.png' });
      await mobile.close();
      await page.getByRole('button', { name: 'Stop and revoke access', exact: true }).click();
      await page.getByLabel('Allow remote prompts and stop requests', { exact: true }).check();
      await page.getByRole('button', { name: 'Start remote access', exact: true }).click();
      const controlToken = await page.getByLabel('Pairing token', { exact: true }).inputValue();
      const controlled = await page.evaluate(() => window.desktop.call('remote:status'));
      await page.evaluate(
        (url) => window.desktop.call('preview:browser', { url }),
        controlled.localUrl,
      );
      await expect.poll(() => app.windows().length).toBe(2);
      const controller = app.windows().find((p) => p !== page)!;
      await controller.getByLabel('Pairing token', { exact: true }).fill(controlToken);
      await controller.getByRole('button', { name: 'Connect', exact: true }).click();
      await expect(controller.locator('#controls')).toBeVisible();
      await controller
        .getByLabel('Prompt', { exact: true })
        .fill('Reply with the fixture marker again. Do not use tools.');
      await controller.getByRole('button', { name: 'Send', exact: true }).click();
      await expect
        .poll(
          () =>
            page.evaluate(
              async () =>
                (await window.desktop.call('background:list')).runs.filter(
                  (r: any) => r.source === 'remote' && r.status === 'completed',
                ).length,
            ),
          { timeout: 30000 },
        )
        .toBe(1);
      expect(
        await page.evaluate(
          async () =>
            (await window.desktop.call('history:page', { id: 't' })).entries.filter(
              (e: any) => e.type === 'user',
            ).length,
        ),
      ).toBe(2);
      await controller.close();
      await page.getByRole('button', { name: 'Stop and revoke access', exact: true }).click();
      await page.getByRole('button', { name: 'Close settings', exact: true }).click();
      await page.getByRole('button', { name: 'Files', exact: true }).click();
      await page.getByRole('button', { name: 'sample.docx', exact: true }).click();
      await expect(page.getByText('OFFICE PREVIEW CONTENT', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Back to files', exact: true }).click();
      await page.getByRole('button', { name: 'sample.pdf', exact: true }).click();
      await expect
        .poll(() =>
          page.locator('.document-preview canvas').evaluate((c: HTMLCanvasElement) => c.width),
        )
        .toBe(600);
      await page.screenshot({ path: '.test-data/extended-pdf.png' });
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
      await page.getByLabel('Interface language', { exact: true }).selectOption('id');
      await page.getByLabel('Accent color', { exact: true }).selectOption('blue');
      await page.getByLabel('Interface font', { exact: true }).selectOption('arial');
      await page.getByLabel('Layout density', { exact: true }).selectOption('compact');
      await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
      await expect(
        page.getByRole('tab', { name: 'Otomasi dan pemantauan PR', exact: true }),
      ).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'id');
      await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue');
      await page.screenshot({ path: '.test-data/extended-localization.png' });
      expect(errors).toEqual([]);
      await app.close();
      app = await launch();
      page = await app.firstWindow();
      await expect(page.locator('html')).toHaveAttribute('lang', 'id');
      expect((await page.evaluate(() => window.desktop.call('remote:status'))).running).toBe(false);
      expect(await readFile(join(root, 'state.json'), 'utf8')).not.toContain('local-fixture-only');
    } finally {
      await app.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
);
