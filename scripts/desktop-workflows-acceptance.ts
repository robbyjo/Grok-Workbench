// Exercises the production host/renderer/native applications in an owned, credential-free profile.
import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { unzipSync, strFromU8 } from 'fflate';
import { wav, readWav } from '../electron/workflows/audio';
import { digest } from '../electron/workflows/io';
import type { Wire } from '../shared/types';
const arg = (key: string) => {
  const i = process.argv.indexOf(key);
  return i < 0 ? undefined : process.argv[i + 1];
};
const domains = (
  arg('--domains') ?? 'office,pdf,files,browser,reports,creative,research,audio,vector'
).split(',');
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  await mkdir('.test-data', { recursive: true });
  const root = await mkdtemp(resolve('.test-data/desktop-workflows-')),
    profile = join(root, 'profile'),
    workspace = join(root, 'workspace');
  await mkdir(profile);
  await mkdir(workspace);
  const now = new Date().toISOString();
  const report: Wire = {
    root,
    enginePin: '2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8',
    engineSha256: digest(await readFile('.runtime/studio-engine.node')),
    checks: [],
    startedAt: now,
  };
  process.stdout.write(JSON.stringify({ root }) + '\n');
  await writeFile(
    join(profile, 'state.json'),
    JSON.stringify({
      version: 1,
      projects: [{ id: 'p', name: 'Desktop workflow acceptance', path: workspace }],
      settings: { executable: 'embedded' },
      threads: [
        {
          id: 't',
          projectId: 'p',
          cwd: workspace,
          title: 'Desktop workflow acceptance',
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
  const samples = Buffer.alloc(16000);
  for (let i = 0; i < 8000; i++)
    samples.writeInt16LE(Math.round(Math.sin((i * Math.PI) / 20) * 3000), i * 2);
  await writeFile(join(workspace, 'tone.wav'), wav(samples, 8000, 1));
  await writeFile(join(workspace, 'data.csv'), 'x,y\n1,3.1\n2,4.9\n3,7.2\n4,8.8\n5,11.1\n6,12.9\n');
  await writeFile(join(workspace, 'one.txt'), 'Original file');
  await writeFile(join(workspace, 'two.txt'), 'Original file');
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([500, 600]);
  page.drawText('WORKBENCH TEST TABLE', { x: 40, y: 540, size: 20 });
  page.drawText('x', { x: 40, y: 480 });
  page.drawText('y', { x: 200, y: 480 });
  for (let i = 1; i <= 3; i++) {
    page.drawText(String(i), { x: 40, y: 480 - 30 * i });
    page.drawText(String(i * 2 + 1), { x: 200, y: 480 - 30 * i });
  }
  pdf
    .getForm()
    .createTextField('reviewer')
    .addToPage(page, { x: 40, y: 100, width: 200, height: 30 });
  pdf.addPage([500, 600]).drawText('SECOND TEST PAGE');
  await writeFile(join(workspace, 'source.pdf'), await pdf.save());
  let submissions = 0;
  const requests: Wire[] = [];
  const fixtureImage = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kAAAASUVORK5CYII=',
    'base64',
  );
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, method: req.method });
    if (req.url === '/submit') {
      submissions++;
      res.end('<h1>Fixture form received</h1>');
    } else if (req.url === '/report.csv') {
      res.setHeader('Content-Disposition', 'attachment; filename="fixture-report.csv"');
      res.end('x,y\n1,2\n');
    } else if (req.url === '/prompt') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ prompt_id: 'fixture-owned' }));
    } else if (req.url === '/history/fixture-owned')
      res.end(
        JSON.stringify({
          'fixture-owned': {
            status: { completed: true },
            outputs: {
              '2': { images: [{ filename: 'fixture.png', type: 'output', subfolder: '' }] },
            },
          },
        }),
      );
    else if (req.url?.startsWith('/view?')) res.end(fixtureImage);
    else if (req.url === '/api/local/authorize') {
      res.setHeader('Zotero-Server-ID', 'fixture-server');
      res.end(JSON.stringify({ key: 'fixture-key', remember: true }));
    } else if (req.url?.startsWith('/api/'))
      res.end(
        req.method === 'POST'
          ? JSON.stringify({ successful: { '0': { key: 'TESTKEY2' } }, failed: {} })
          : '[]',
      );
    else {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><html><head><title>Owned administration fixture</title></head><body><h1>Report request</h1><form method="post" action="/submit"><label>Reviewer <input name="reviewer" aria-label="Reviewer"></label><label>Report type <select name="type" aria-label="Report type"><option value="summary">Summary</option><option value="full">Full report</option></select></label><label><input type="checkbox" name="include" aria-label="Include charts">Include charts</label><input type="hidden" name="csrf" value="fixture-hidden-token"><button>Submit request</button></form><a href="/report.csv">Download report</a></body></html>',
      );
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + (server.address() as any).port;
  let app: ElectronApplication | undefined;
  const check = async (name: string, fn: () => Promise<Wire | void>) => {
    try {
      const detail = await fn();
      report.checks.push({ name, passed: true, ...detail });
      process.stdout.write(name + ': passed\n');
    } catch (e) {
      report.checks.push({ name, passed: false, error: String(e) });
      process.stdout.write(name + ': FAILED ' + String(e).slice(0, 400) + '\n');
    }
  };
  try {
    app = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        GROK_DESKTOP_DATA_DIR: profile,
        GROK_HOME: join(profile, 'grok'),
        XAI_API_KEY: '',
        GROK_CODE_XAI_API_KEY: '',
        GROK_DEPLOYMENT_KEY: '',
      },
    });
    const ui = await app.firstWindow();
    // Capture the real production instance through instrumentation confined to this test process.
    await app.evaluate(({ app }) => {
      const req = process
        .getBuiltinModule('module')
        .createRequire(app.getAppPath() + '/package.json');
      const { DesktopWorkflows } = req(
        app.getAppPath() + '/dist-electron/electron/desktop-workflows.js',
      );
      const original = DesktopWorkflows.prototype.status;
      DesktopWorkflows.prototype.status = function (...args: any[]) {
        (globalThis as any).acceptWorkflows = this;
        return original.apply(this, args);
      };
    });
    const ipc = (method: string, args: Wire = {}) =>
      ui.evaluate(({ method, args }) => window.desktop.call(method, { id: 't', ...args }), {
        method,
        args,
      });
    await ipc('desktop-workflows:status');
    await ipc('desktop-workflows:grant', {
      domains: ['pdf', 'files', 'browser', 'reports', 'creative', 'research', 'audio', 'vector'],
    });
    await ipc('application:grant', { applications: ['office', 'jmp', 'blender', 'krita'] });
    const invoke = (name: string, input: Wire) =>
      app!.evaluate(
        async (_e, { name, input }) => (globalThis as any).acceptWorkflows.invoke('t', name, input),
        { name, input },
      );
    const native = (name: string, input: Wire) =>
      app!.evaluate(
        async (_e, { name, input }) =>
          (globalThis as any).acceptWorkflows.workstation.invoke('t', name, input),
        { name, input },
      );
    const job = async (name: string, input: Wire, isNative = false) => {
      const reply = await (isNative ? native(name, input) : invoke(name, input));
      assert.ok(!reply.isError, reply.content[0]?.text);
      const row = JSON.parse(reply.content[0].text);
      const deadline = Date.now() + 240000;
      while (Date.now() < deadline) {
        const status: any = await ipc(isNative ? 'application:status' : 'desktop-workflows:status');
        const current = status.jobs.find((j: Wire) => j.id === row.id);
        if (current?.state === 'complete') return current;
        if (['failed', 'stopped'].includes(current?.state)) throw new Error(current.error);
        await pause(200);
      }
      throw new Error('Timed out: ' + name);
    };
    await ui.getByRole('button', { name: /^Desktop & read aloud/ }).click();
    await ui.getByText('Office, shopping, art, science & chess', { exact: true }).click();
    await ui.getByText('Documents, browser & desktop workflows', { exact: true }).click();
    if (domains.includes('office'))
      await check('native-Office-copy-edit-and-PowerPoint', async () => {
        const word = await job(
            'office_create',
            {
              kind: 'word',
              title: 'Original report',
              text: 'Original paragraph for revision.',
              table: [
                ['Task', 'Status'],
                ['Sample', 'Open'],
              ],
            },
            true,
          ),
          wordPath = word.files[0].path,
          before = digest(await readFile(wordPath));
        const edited = await job(
          'office_edit',
          {
            kind: 'word',
            path: wordPath,
            replacements: [{ find: 'Original paragraph', replace: 'Revised paragraph' }],
            comments: [{ find: 'paragraph', text: 'Review this revision.' }],
            append: 'Appendix note.',
          },
          true,
        );
        const files = unzipSync(await readFile(edited.files[0].path));
        assert.ok(files['word/comments.xml']);
        const xml = strFromU8(files['word/document.xml']);
        assert.match(xml, /Revised paragraph/);
        assert.match(xml, /<w:ins\b/);
        assert.equal(digest(await readFile(wordPath)), before);
        const excel = await job(
            'office_create',
            {
              kind: 'spreadsheet',
              headers: ['Item', 'Cost'],
              rows: [
                ['Paper', 12],
                ['Ink', 28],
              ],
              formulas: [{ cell: 'B4', formula: '=SUM(B2:B3)' }],
            },
            true,
          ),
          excelBefore = digest(await readFile(excel.files[0].path));
        const update = await job(
          'office_edit',
          {
            kind: 'spreadsheet',
            path: excel.files[0].path,
            cells: [{ cell: 'B2', value: 20 }],
            formulas: [{ cell: 'B4', formula: '=SUM(B2:B3)' }],
            chart: true,
          },
          true,
        );
        assert.equal(update.result.formulaResults[0].value, 48);
        assert.equal(digest(await readFile(excel.files[0].path)), excelBefore);
        assert.ok(unzipSync(await readFile(update.files[0].path))['xl/charts/chart1.xml']);
        const deck = await job(
          'office_create',
          {
            kind: 'presentation',
            slides: [{ title: 'Initial slide', text: 'A new editable presentation.' }],
            pdf: true,
          },
          true,
        );
        const expanded = await job(
          'office_edit',
          {
            kind: 'presentation',
            path: deck.files[0].path,
            slides: [{ title: 'Added slide', text: 'The original presentation is preserved.' }],
            pdf: true,
          },
          true,
        );
        assert.equal(expanded.result.slides, 2);
        assert.equal(
          (
            await PDFDocument.load(
              await readFile(expanded.files.find((f: Wire) => f.name === 'presentation.pdf').path),
            )
          ).getPageCount(),
          2,
        );
        return { word: edited.files, excel: update.files, presentation: expanded.files };
      });
    let vector: Wire | undefined;
    if (domains.includes('vector') || domains.includes('pdf'))
      await check('rendered-editable-SVG-and-multiple-exports', async () => {
        vector = await job('vector_graphic', {
          width: 1000,
          height: 240,
          shapes: [
            { kind: 'rect', x: 0, y: 0, width: 1000, height: 240, fill: '#ffffff' },
            {
              kind: 'text',
              x: 30,
              y: 120,
              font_size: 54,
              fill: '#111111',
              text: 'WORKBENCH OCR 314159',
            },
          ],
          sizes: [
            { width: 1000, height: 240 },
            { width: 500, height: 120 },
          ],
          pdf: true,
        });
        assert.ok(vector);
        assert.equal(vector.files.filter((f: Wire) => f.name.endsWith('.png')).length, 2);
        const original = vector.files.find((f: Wire) => f.name === 'drawing.svg'),
          hash = digest(await readFile(original.path));
        const edit = await job('vector_graphic', {
          path: original.path,
          edits: [{ id: 'shape-2', fill: '#1155aa' }],
          sizes: [{ width: 1000, height: 240 }],
        });
        assert.equal(digest(await readFile(original.path)), hash);
        return { files: vector.files, edited: edit.files };
      });
    if (domains.includes('pdf')) {
      await check('actual-PDF-extraction-fill-split-merge-annotations', async () => {
        const extract = await job('document_workflow', {
          action: 'extract',
          paths: ['source.pdf'],
          pages: [1],
          columns: [150],
        });
        assert.match(
          await readFile(extract.files.find((f: Wire) => f.name === 'extracted.txt').path, 'utf8'),
          /WORKBENCH TEST TABLE/,
        );
        assert.match(
          await readFile(
            extract.files.find((f: Wire) => f.name === 'table-page-1.csv').path,
            'utf8',
          ),
          /"1","3"/,
        );
        const fill = await job('document_workflow', {
          action: 'fill',
          paths: ['source.pdf'],
          fields: { reviewer: 'Verified' },
        });
        assert.equal(
          (await PDFDocument.load(await readFile(fill.files[0].path)))
            .getForm()
            .getTextField('reviewer')
            .getText(),
          'Verified',
        );
        const split = await job('document_workflow', {
          action: 'split',
          paths: ['source.pdf'],
          pages: [1, 2],
        });
        const merge = await job('document_workflow', {
          action: 'merge',
          paths: split.files.filter((f: Wire) => f.name.endsWith('.pdf')).map((f: Wire) => f.path),
        });
        assert.equal(
          (await PDFDocument.load(await readFile(merge.files[0].path))).getPageCount(),
          2,
        );
        const annotate = await job('document_workflow', {
          action: 'annotate',
          paths: ['source.pdf'],
          annotations: [
            { page: 1, x: 35, y: 530, width: 320, height: 25 },
            { page: 2, x: 40, y: 500, text: 'Review annotation' },
          ],
        });
        return { extracted: extract.files, annotated: annotate.files };
      });
      await check('native-offline-image-and-scanned-PDF-OCR', async () => {
        assert.ok(vector);
        const image = vector.files.find((f: Wire) => f.name === 'drawing-1000x240.png');
        const imageOCR = await job('document_workflow', { action: 'ocr', paths: [image.path] });
        assert.match(
          await readFile(imageOCR.files.find((f: Wire) => f.name === 'extracted.txt').path, 'utf8'),
          /314159/,
        );
        const scan = await PDFDocument.create(),
          png = await scan.embedPng(await readFile(image.path)),
          page = scan.addPage([1000, 240]);
        page.drawImage(png, { x: 0, y: 0, width: 1000, height: 240 });
        await writeFile(join(workspace, 'scan.pdf'), await scan.save());
        const scanOCR = await job('document_workflow', {
          action: 'ocr',
          paths: ['scan.pdf'],
          pages: [1],
        });
        assert.match(
          await readFile(scanOCR.files.find((f: Wire) => f.name === 'extracted.txt').path, 'utf8'),
          /314159/,
        );
        return { image: imageOCR.files, scan: scanOCR.files };
      });
    }
    if (domains.includes('files'))
      await check('real-IPC-file-plan-review-and-undo', async () => {
        const plan = JSON.parse(
          (
            await invoke('file_organize', {
              paths: ['one.txt', 'two.txt'],
              directory: 'organized',
              prefix: 'sorted-',
            })
          ).content[0].text,
        );
        assert.equal(await readFile(join(workspace, 'one.txt'), 'utf8'), 'Original file');
        await ui.getByRole('button', { name: 'Apply reviewed file plan' }).click();
        for (let i = 0; i < 50; i++) {
          if (
            ((await ipc('desktop-workflows:status')) as Wire).plans.find(
              (p: Wire) => p.id === plan.id,
            )?.state === 'applied'
          )
            break;
          await pause(100);
        }
        await assert.rejects(readFile(join(workspace, 'one.txt')));
        await ui.getByRole('button', { name: 'Undo reviewed file plan' }).click();
        for (let i = 0; i < 50; i++) {
          if (
            ((await ipc('desktop-workflows:status')) as Wire).plans.find(
              (p: Wire) => p.id === plan.id,
            )?.state === 'undone'
          )
            break;
          await pause(100);
        }
        assert.equal(await readFile(join(workspace, 'one.txt'), 'utf8'), 'Original file');
        return { journal: plan.journal };
      });
    if (domains.includes('browser'))
      await check('isolated-browser-fill-review-submit-and-download', async () => {
        await ipc('desktop-workflows:browser', { url: origin });
        let view = JSON.parse((await invoke('browser_view', {})).content[0].text);
        assert.ok(!JSON.stringify(view).includes('fixture-hidden-token'));
        await invoke('browser_act', {
          frame: view.frame,
          action: 'fill',
          reference: view.controls.find((c: Wire) => c.label === 'Reviewer').reference,
          value: 'Workbench fixture',
        });
        await assert.rejects(
          invoke('browser_act', {
            frame: view.frame,
            action: 'fill',
            reference: 'c0',
            value: 'stale',
          }),
          /stale/,
        );
        view = JSON.parse((await invoke('browser_view', {})).content[0].text);
        await invoke('browser_act', {
          frame: view.frame,
          action: 'select',
          reference: view.controls.find((c: Wire) => c.label === 'Report type').reference,
          value: 'full',
        });
        view = JSON.parse((await invoke('browser_view', {})).content[0].text);
        await invoke('browser_act', {
          frame: view.frame,
          action: 'prepare_submit',
          reference: view.forms[0].reference,
        });
        assert.equal(submissions, 0);
        await ui.getByRole('button', { name: 'Submit reviewed form' }).click();
        for (let i = 0; i < 50 && submissions === 0; i++) await pause(100);
        assert.equal(submissions, 1);
        await ipc('desktop-workflows:browser', { url: origin });
        view = JSON.parse((await invoke('browser_view', {})).content[0].text);
        try {
          await invoke('browser_act', {
            frame: view.frame,
            action: 'download',
            reference: view.controls.find((c: Wire) => c.label === 'Download report').reference,
          });
        } catch (e) {
          if (!String(e).includes('ERR_ABORTED')) throw e;
        }
        let state: any;
        for (let i = 0; i < 50; i++) {
          state = await ipc('desktop-workflows:status');
          if (state.browser.downloads.some((d: Wire) => d.state === 'completed')) break;
          await pause(100);
        }
        assert.equal(state.browser.downloads[0].state, 'completed');
        await writeFile(
          join(root, 'browser.png'),
          Buffer.from((await invoke('browser_view', {})).content[1].data, 'base64'),
        );
        return { submissions, downloads: state.browser.downloads };
      });
    if (domains.includes('reports'))
      await check('native-CSV-to-JMP-to-illustrated-Word-Excel-slides', async () => {
        const result = await job('report_create', {
          path: 'data.csv',
          x: 'x',
          y: 'y',
          include_workbook: true,
          include_slides: true,
          title: 'Verified regression report',
        });
        const detail = JSON.parse(
          await readFile(
            result.files.find((f: Wire) => f.name === 'workflow-result.json').path,
            'utf8',
          ),
        );
        assert.equal(detail.native.verifiedAgainstIndependentOLS, true);
        const doc = unzipSync(
          await readFile(result.files.find((f: Wire) => f.name === 'document.docx').path),
        );
        assert.ok(Object.keys(doc).some((k) => k.startsWith('word/media/')));
        return { files: result.files, native: detail.native };
      });
    if (domains.includes('creative')) {
      await check('native-Blender-batch-variants', async () => {
        const result = await job('creative_batch', {
          kind: 'blender',
          variants: [
            { objects: [{ kind: 'cube', color: [0.1, 0.4, 0.9, 1] }] },
            { objects: [{ kind: 'sphere', color: [0.9, 0.3, 0.1, 1] }] },
          ],
        });
        assert.equal(result.files.filter((f: Wire) => f.name.endsWith('.blend')).length, 2);
        return { files: result.files };
      });
      await check('ComfyUI-real-HTTP-protocol-fixture', async () => {
        await writeFile(
          join(workspace, 'workflow.json'),
          JSON.stringify({
            '1': { class_type: 'EmptyImage', inputs: { width: 32, height: 32 } },
            '2': { class_type: 'SaveImage', inputs: { images: ['1', 0] } },
          }),
        );
        await ipc('desktop-workflows:comfy', { path: 'workflow.json', origin });
        const result = await job('creative_batch', { kind: 'comfy', path: 'workflow.json' });
        assert.ok(result.files.some((f: Wire) => f.name.endsWith('.png')));
        return { files: result.files, scope: 'Protocol fixture, not native ComfyUI inference' };
      });
    }
    if (domains.includes('research'))
      await check('research-CSL-RIS-cited-notes-Word-and-Zotero-review', async () => {
        const result = await job('research_library', {
          items: [
            {
              id: 'fixture',
              title: 'Workbench fixture reference',
              author: [{ family: 'Example', given: 'A' }],
              issued: { 'date-parts': [[2026]] },
            },
          ],
          annotations: [
            {
              item_id: 'fixture',
              page: 1,
              quote: 'WORKBENCH TEST TABLE',
              note: 'Actual source.pdf fixture heading',
            },
          ],
          word_report: true,
        });
        assert.match(
          await readFile(result.files.find((f: Wire) => f.name === 'cited-notes.md').path, 'utf8'),
          /fixture, p\. 1/,
        );
        await app!.evaluate(async ({ app }, origin) => {
          const req = process
            .getBuiltinModule('module')
            .createRequire(app.getAppPath() + '/package.json');
          const { ZoteroLocal } = req(
            app.getAppPath() + '/dist-electron/electron/workflows/research.js',
          );
          (globalThis as any).acceptWorkflows.zotero = new ZoteroLocal(origin);
        }, origin);
        await job('research_library', {
          items: [{ id: 'fixture', title: 'Workbench fixture reference', author: [] }],
          prepare_zotero: true,
          title: 'Owned fixture collection',
        });
        await ui.getByRole('button', { name: 'Authorize local Zotero writes' }).click();
        await ui.getByRole('button', { name: 'Create reviewed Zotero collection' }).click();
        assert.ok(requests.some((r) => r.path === '/api/users/0/items' && r.method === 'POST'));
        return {
          files: result.files,
          zotero: 'Protocol fixture; no personal Zotero library modified',
        };
      });
    if (domains.includes('audio'))
      await check('real-audio-trim-join-normalize-and-playback-decode', async () => {
        const result = await job('audio_edit', {
          paths: ['tone.wav', 'tone.wav'],
          trims: [
            { start: 0.25, end: 0.75 },
            { start: 0, end: 0.5 },
          ],
          normalize_db: -6,
        });
        const bytes = await readFile(result.files.find((f: Wire) => f.name === 'edited.wav').path),
          decoded = readWav(bytes);
        assert.equal(decoded.frames, 8000);
        return { files: result.files, seconds: decoded.frames / decoded.rate };
      });
    const kritaRoot = arg('--krita-root');
    if (kritaRoot)
      await check('native-Krita-owned-document-batch-export', async () => {
        const invokeKrita = async (tool: string, args: Wire = {}) => {
          const reply = await native('krita_tools', { tool, arguments: args });
          assert.ok(!reply.isError, JSON.stringify(reply));
          return reply;
        };
        await invokeKrita('krita_state');
        const documents: Wire[] = [];
        const scratch = await mkdtemp(join(resolve(kritaRoot), '.workbench-v090-'));
        try {
          for (let i = 0; i < 2; i++) {
            const created = await invokeKrita('krita_document', {
              action: 'create',
              width: 128,
              height: 128,
              name: `Workbench batch check ${i + 1}`,
            });
            const document_id = JSON.parse(
              created.content.find((c: Wire) => c.type === 'text').text,
            ).affected_document_id;
            documents.push({
              document_id,
              kra_path: join(scratch, `batch-${i}.kra`),
              png_path: join(scratch, `batch-${i}.png`),
            });
            await invokeKrita('krita_state');
            await invokeKrita('krita_preview', { document_id });
            await invokeKrita('krita_draw', {
              document_id,
              shape: 'rectangle',
              x: 16,
              y: 16,
              width: 96,
              height: 96,
              foreground: i ? '#247ba0' : '#e56b2f',
              fill_style: 'ForegroundColor',
              stroke_style: 'None',
            });
            await invokeKrita('krita_preview', { document_id });
          }
          const result = await job('creative_batch', { kind: 'krita', documents });
          for (const [i, document] of documents.entries()) {
            const kra = await readFile(document.kra_path);
            assert.ok(unzipSync(kra)['mergedimage.png']);
            await writeFile(join(root, `krita-batch-${i}.kra`), kra);
            await copyFile(document.png_path, join(root, `krita-batch-${i}.png`));
          }
          return { result: result.result, scratch };
        } finally {
          for (const document of documents) {
            await invokeKrita('krita_state');
            await invokeKrita('krita_document', {
              action: 'close',
              document_id: document.document_id,
              discard_changes: true,
            });
          }
        }
      });
    const compressedAudio = arg('--audio-input');
    if (compressedAudio)
      await check('compressed-audio-renderer-decode-and-export', async () => {
        await copyFile(resolve(compressedAudio), join(workspace, 'compressed.mp3'));
        const result = await job('audio_edit', {
          paths: ['compressed.mp3'],
          trims: [{ start: 0, end: 0.5 }],
          normalize_db: -3,
        });
        const decoded = readWav(
          await readFile(result.files.find((f: Wire) => f.name === 'edited.wav').path),
        );
        assert.ok(decoded.rate >= 8000);
        assert.ok(Math.abs(decoded.frames / decoded.rate - 0.5) < 0.002);
        return { files: result.files, rate: decoded.rate, channels: decoded.channels };
      });
    const inkscape = arg('--inkscape');
    const comfyOrigin = arg('--comfy-origin');
    if (comfyOrigin)
      await check('native-ComfyUI-approved-local-workflow', async () => {
        await writeFile(
          join(workspace, 'native-workflow.json'),
          JSON.stringify({
            '1': {
              class_type: 'EmptyImage',
              inputs: { width: 64, height: 64, batch_size: 1, color: 3368601 },
            },
            '2': {
              class_type: 'SaveImage',
              inputs: {
                images: ['1', 0],
                filename_prefix: 'GrokWorkbench-Acceptance-' + Date.now(),
              },
            },
          }),
        );
        await ipc('desktop-workflows:comfy', { path: 'native-workflow.json', origin: comfyOrigin });
        const result = await job('creative_batch', { kind: 'comfy', path: 'native-workflow.json' });
        const image = await readFile(result.files.find((f: Wire) => f.name.endsWith('.png')).path);
        assert.equal(image.readUInt32BE(16), 64);
        assert.equal(image.readUInt32BE(20), 64);
        return {
          files: result.files,
          scope:
            'Native ComfyUI EmptyImage/SaveImage execution; no learned model or cloud service used.',
        };
      });
    if (process.argv.includes('--audacity'))
      await check('native-Audacity-pipe-normalization-and-export', async () => {
        const result = await job('audio_edit', {
          paths: ['tone.wav'],
          normalize_db: -6,
          backend: 'audacity',
        });
        const output = await readFile(
          result.files.find((f: Wire) => f.name === 'audacity-export.wav').path,
        );
        assert.equal(readWav(output).frames, 8000);
        return {
          files: result.files,
          scope: 'Dedicated owned Audacity 3.7.9 project; original profiles preserved.',
        };
      });
    if (inkscape)
      await check('native-Inkscape-vector-PDF-and-PNG-export', async () => {
        await ipc('desktop-workflows:inkscape', { path: resolve(inkscape) });
        const result = await job('vector_graphic', {
          backend: 'inkscape',
          shapes: [
            { kind: 'rect', x: 40, y: 40, width: 200, height: 100, fill: '#3377bb' },
            { kind: 'text', x: 50, y: 90, text: 'Native Inkscape' },
          ],
          sizes: [
            { width: 800, height: 600 },
            { width: 400, height: 300 },
          ],
          pdf: true,
        });
        assert.equal(
          (
            await PDFDocument.load(
              await readFile(result.files.find((f: Wire) => f.name === 'drawing.pdf').path),
            )
          ).getPageCount(),
          1,
        );
        return { files: result.files };
      });
    await ui.screenshot({ path: join(root, 'workflow-panel.png'), fullPage: true });
    await ipc('agent:disconnect');
    assert.deepEqual(((await ipc('desktop-workflows:status')) as Wire).granted, []);
    report.passed = report.checks.every((c: Wire) => c.passed);
  } finally {
    await app?.close().catch(() => {});
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2));
    process.stdout.write(
      JSON.stringify({ report: join(root, 'report.json'), passed: report.passed }) + '\n',
    );
  }
  if (!report.passed) throw new Error('One or more desktop workflow checks failed.');
}
void main().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exitCode = 1;
});
