import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { zipSync, strToU8 } from 'fflate';
import { FilePlans } from '../electron/workflows/files';
import { workspaceFile, workspaceDestination } from '../electron/workflows/io';
import { csvRows, numericPairs, readTable } from '../electron/workflows/tabular';
import { pdfWorkflow } from '../electron/workflows/pdf';
import { wav, readWav, editAudio } from '../electron/workflows/audio';
import { createSvg, editSvg } from '../electron/workflows/vector';
import {
  references,
  parseRis,
  toRis,
  exportResearch,
  ZoteroLocal,
} from '../electron/workflows/research';
import { ComfyWorkflows } from '../electron/workflows/comfy';
import { officeEditInput, officeSource } from '../electron/workflows/office';
import { desktopWorkflowTools } from '../electron/workflows/schema';

test('workflow schemas describe nested fields needed by the live model', () => {
  const tool = (name: string): any =>
    desktopWorkflowTools.find((t) => t.name === name)?.inputSchema;
  const vector = tool('vector_graphic').properties.shapes.items;
  assert.deepEqual(vector.required, ['kind']);
  assert.ok(vector.properties.kind.enum.includes('rect'));
  assert.ok(vector.properties.fill);
  assert.ok(tool('document_workflow').properties.fields.items.properties.checked);
  assert.ok(
    tool('research_library').properties.items.items.properties.issued.properties['date-parts'],
  );
  assert.ok(
    tool('creative_batch').properties.scenes.items.properties.objects.items.properties.kind,
  );
  assert.ok(
    tool('creative_batch').properties.overrides.items.properties.changes.items.properties.node,
  );
  assert.ok(tool('browser_act').properties.action.enum.includes('download'));
});
async function fixture(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'wb-v090-'));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('file plans require exact owner/hash, refuse changed/colliding files and undo persisted moves', async () =>
  fixture(async (root) => {
    await writeFile(join(root, 'one.txt'), 'original');
    await writeFile(join(root, 'two.txt'), 'original');
    const plans = new FilePlans(),
      p = await plans.preview('t', root, {
        paths: ['one.txt', 'two.txt'],
        prefix: 'sorted-',
        directory: 'organized',
        group_by_extension: true,
      });
    assert.equal(p.duplicates.length, 1);
    assert.equal(await readFile(join(root, 'one.txt'), 'utf8'), 'original');
    await assert.rejects(plans.review('other', p.id, p.hash), /another chat/);
    await assert.rejects(plans.review('t', p.id, 'stale'), /changed/);
    const moved = await plans.review('t', p.id, p.hash);
    assert.equal(moved.state, 'applied');
    await assert.rejects(stat(join(root, 'one.txt')));
    const recovered = new FilePlans();
    await recovered.restore('t', root, moved.journal);
    assert.equal((await recovered.review('t', p.id, p.hash, true)).state, 'undone');
    assert.equal(await readFile(join(root, 'one.txt'), 'utf8'), 'original');
    const changed = await plans.preview('t', root, { paths: ['one.txt'], directory: 'changed' });
    await writeFile(join(root, 'one.txt'), 'externally changed');
    await assert.rejects(plans.review('t', changed.id, changed.hash), /changed since/);
    await mkdir(join(root, 'collision'));
    await writeFile(join(root, 'collision', 'two.txt'), 'keep');
    const collision = await plans.preview('t', root, {
      paths: ['two.txt'],
      directory: 'collision',
    });
    await assert.rejects(plans.review('t', collision.id, collision.hash), /Destination exists/);
    assert.equal(await readFile(join(root, 'collision', 'two.txt'), 'utf8'), 'keep');
    await assert.rejects(workspaceFile(root, '../outside'), /ENOENT|leaves/);
  }));

test('workflow files accept a selected root alias but reject links inside it', async () =>
  fixture(async (root) => {
    const actual = join(root, 'actual'),
      alias = join(root, 'alias');
    await mkdir(actual);
    await writeFile(join(actual, 'source.txt'), 'preserved');
    await symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(
      (await workspaceFile(alias, join(alias, 'source.txt'))).bytes.toString(),
      'preserved',
    );
    const destination = await workspaceDestination(alias, join(alias, 'organized', 'source.txt'));
    assert.ok(destination.endsWith(join('organized', 'source.txt')));
    const plans = new FilePlans();
    const plan = await plans.preview('t', alias, { paths: ['source.txt'], directory: 'organized' });
    await plans.review('t', plan.id, plan.hash);
    const recovered = new FilePlans();
    await recovered.restore('t', alias, plan.journal);
    await recovered.review('t', plan.id, plan.hash, true);
    assert.equal(await readFile(join(actual, 'source.txt'), 'utf8'), 'preserved');
    await mkdir(join(actual, 'nested'));
    await writeFile(join(actual, 'nested', 'private.txt'), 'keep');
    await symlink(
      join(actual, 'nested'),
      join(actual, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await assert.rejects(workspaceFile(alias, 'linked/private.txt'), /Linked/);
    await assert.rejects(workspaceDestination(alias, 'linked/new.txt'), /Linked/);
  }));
test('tabular import preserves quoted cells and rejects missing values and stale formula caches', async () =>
  fixture(async (root) => {
    const rows = csvRows('x,y,label\r\n1,3,"a,b"\r\n2,5,"line\nnext"\r\n3,7,z\r\n');
    assert.equal(rows[1][2], 'a,b');
    assert.equal(rows[2][2], 'line\nnext');
    assert.deepEqual(numericPairs(rows, 'x', 'y'), [
      [1, 3],
      [2, 5],
      [3, 7],
    ]);
    assert.throws(() => csvRows('x,"unfinished'), /Unterminated/);
    assert.throws(
      () =>
        numericPairs(
          [
            ['x', 'y'],
            ['1', '2'],
            ['2', ''],
            ['3', '7'],
          ],
          'x',
          'y',
        ),
      /missing/,
    );
    await writeFile(
      join(root, 'stale.xlsx'),
      zipSync({
        'xl/worksheets/sheet1.xml': strToU8(
          '<worksheet><sheetData><row><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>',
        ),
      }),
    );
    await assert.rejects(readTable(root, 'stale.xlsx'), /stale/);
  }));
test('PDF fill, select, split, merge and annotations produce new valid files and preserve source', async () =>
  fixture(async (root) => {
    const source = await PDFDocument.create();
    source.addPage([400, 400]).drawText('First page');
    source.addPage([400, 400]).drawText('Second page');
    const field = source.getForm().createTextField('name');
    field.addToPage(source.getPage(0), { x: 30, y: 100, width: 200, height: 30 });
    const bytes = await source.save();
    await writeFile(join(root, 'source.pdf'), bytes);
    for (const dir of ['fill', 'select', 'split', 'merge', 'annotate'])
      await mkdir(join(root, dir));
    const filled = await pdfWorkflow(root, join(root, 'fill'), {
      action: 'fill',
      paths: ['source.pdf'],
      fields: { name: 'Workbench' },
    });
    assert.equal(
      (await PDFDocument.load(await readFile(filled.files[0].path)))
        .getForm()
        .getTextField('name')
        .getText(),
      'Workbench',
    );
    const selected = await pdfWorkflow(root, join(root, 'select'), {
      action: 'select',
      paths: ['source.pdf'],
      pages: [2],
    });
    assert.equal(
      (await PDFDocument.load(await readFile(selected.files[0].path))).getPageCount(),
      1,
    );
    const split = await pdfWorkflow(root, join(root, 'split'), {
      action: 'split',
      paths: ['source.pdf'],
      pages: [1, 2],
    });
    assert.equal(split.files.length, 2);
    const merged = await pdfWorkflow(root, join(root, 'merge'), {
      action: 'merge',
      paths: split.files.map((f) => f.path),
    });
    assert.equal((await PDFDocument.load(await readFile(merged.files[0].path))).getPageCount(), 2);
    const marked = await pdfWorkflow(root, join(root, 'annotate'), {
      action: 'annotate',
      paths: ['source.pdf'],
      annotations: [
        { page: 1, x: 20, y: 200, width: 100, height: 20 },
        { page: 2, x: 20, y: 250, text: 'Review note' },
      ],
    });
    assert.ok((await readFile(marked.files[0].path)).length > bytes.length);
    assert.deepEqual(await readFile(join(root, 'source.pdf')), Buffer.from(bytes));
    await assert.rejects(
      pdfWorkflow(root, root, { action: 'select', paths: ['source.pdf'], pages: [0] }),
      /1-based/,
    );
  }));
test('audio trims/joins samples exactly, peak-normalizes and preserves inputs', () => {
  const samples = Buffer.alloc(16000);
  for (let n = 0; n < 8000; n++) samples.writeInt16LE(n % 2 ? 1000 : -1000, n * 2);
  const source = wav(samples, 8000, 1),
    before = Buffer.from(source);
  const result = editAudio([source, source], {
    trims: [
      { start: 0.25, end: 0.75 },
      { start: 0, end: 0.5 },
    ],
    normalize_db: -6,
  });
  const output = readWav(result.bytes);
  assert.equal(output.frames, 8000);
  assert.ok(Math.abs(output.data.readInt16LE(0)) >= 16400);
  assert.ok(Math.abs(output.data.readInt16LE(0)) <= 16430);
  assert.deepEqual(source, before);
  assert.throws(() => editAudio([source, wav(samples, 16000, 1)], {}), /same sample/);
  assert.throws(() => readWav(source.subarray(0, 30)), /PCM WAV/);
});
test('SVG edits preserve an editable copy and reject active/external content', () => {
  const original = createSvg({
    shapes: [
      { kind: 'rect', x: 10, y: 10, width: 100, height: 50, fill: '#123456' },
      { kind: 'text', x: 20, y: 30, text: 'A < B' },
    ],
  });
  const edited = editSvg(original, [{ id: 'shape-1', fill: '#abcdef', translate: [10, 20] }]);
  assert.ok(original.includes('#123456'));
  assert.ok(edited.includes('#abcdef'));
  assert.ok(edited.includes('translate(10 20)'));
  for (const source of [
    '<svg><script>alert(1)</script></svg>',
    '<svg><image href="https://x.example/a"/></svg>',
    '<!DOCTYPE svg><svg/>',
    '<svg onload="x()"/>',
    '<svg><rect style="fill:url(https://x)"/></svg>',
  ])
    assert.throws(() => editSvg(source, [{ id: 'a', fill: '#fff' }]));
  assert.throws(() => createSvg({ shapes: [{ kind: 'rect', fill: '#12345' }] }));
});
test('research interchange keeps identifiers, real page citations and explicit missing metadata', async () =>
  fixture(async (root) => {
    const items = references([
      {
        id: 'fixture',
        title: 'Fixture research',
        author: [{ family: 'Example', given: 'A' }],
        issued: { 'date-parts': [[2026]] },
        DOI: '10.0000/fixture',
      },
    ]);
    const parsed = parseRis(toRis(items));
    assert.equal(parsed[0].title, items[0].title);
    assert.equal(parsed[0].id, items[0].id);
    assert.equal(parsed[0].author[0].family, 'Example');
    const result = await exportResearch(root, items, [
      { item_id: 'fixture', page: 2, quote: 'Verified fixture text', note: 'Test annotation' },
    ]);
    assert.equal(result.files.length, 4);
    assert.match(await readFile(join(root, 'cited-notes.md'), 'utf8'), /fixture, p\. 2/);
    await assert.rejects(
      exportResearch(root, items, [{ item_id: 'invented', page: 1 }]),
      /known reference/,
    );
  }));
test('Office copied-source validation rejects active/external relationships and keeps literal edits', async () =>
  fixture(async (root) => {
    const doc = officeEditInput({
      kind: 'word',
      path: 'sample.docx',
      replacements: [{ find: 'original', replace: 'revised' }],
      comments: [{ find: 'revised', text: 'Check' }],
    });
    assert.equal(doc.tracked, true);
    assert.throws(
      () =>
        officeEditInput({
          kind: 'word',
          path: 'sample.docx',
          replacements: [{ find: '^p', replace: 'x' }],
        }),
      /caret/,
    );
    await writeFile(
      join(root, 'external.docx'),
      zipSync({
        '[Content_Types].xml': strToU8('<Types/>'),
        'word/_rels/document.xml.rels': strToU8(
          '<Relationships><Relationship TargetMode="External" Target="https://external.example/template"/></Relationships>',
        ),
      }),
    );
    await assert.rejects(officeSource(root, root, 'external.docx'), /External/);
  }));
test('Comfy execution is hash-approved and Zotero writes use local authorization/server identity', async () =>
  fixture(async (root) => {
    const calls: { path: string; headers: any; body: any }[] = [];
    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kAAAASUVORK5CYII=',
      'base64',
    );
    const server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      calls.push({ path: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/prompt') res.end(JSON.stringify({ prompt_id: 'owned-job' }));
      else if (req.url === '/history/owned-job')
        res.end(
          JSON.stringify({
            'owned-job': {
              status: { completed: true },
              outputs: {
                '2': { images: [{ filename: 'fixture.png', subfolder: '', type: 'output' }] },
              },
            },
          }),
        );
      else if (req.url!.startsWith('/view?')) res.end(image);
      else if (req.url === '/api/local/authorize') {
        res.setHeader('Zotero-Server-ID', 'fixture-server');
        res.end(JSON.stringify({ key: 'not-a-real-key', remember: true }));
      } else if (req.method === 'POST') {
        if (
          req.headers['zotero-api-key'] !== 'not-a-real-key' ||
          req.headers['zotero-server-id'] !== 'fixture-server'
        ) {
          res.writeHead(401).end('{}');
          return;
        }
        res.end(JSON.stringify({ successful: { '0': { key: 'ITEMKEY2' } }, failed: {} }));
      } else res.end('[]');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + (server.address() as any).port;
    try {
      const comfy = new ComfyWorkflows();
      const path = join(root, 'workflow.json');
      await writeFile(
        path,
        JSON.stringify({
          '1': { class_type: 'EmptyImage', inputs: { width: 32, height: 32 } },
          '2': { class_type: 'SaveImage', inputs: { images: ['1', 0] } },
        }),
      );
      await assert.rejects(
        comfy.run('t', root, root, { path }, new AbortController().signal),
        /approve/,
      );
      await comfy.approve('t', root, path, origin);
      const result = await comfy.run('t', root, root, { path }, new AbortController().signal);
      assert.equal(result.result.runs[0].state, 'complete');
      assert.equal(result.files[0].name, 'variant-1-1.png');
      await writeFile(path, '{}');
      await assert.rejects(
        comfy.run('t', root, root, { path }, new AbortController().signal),
        /changed/,
      );
      assert.ok(!calls.some((c) => /interrupt|queue/.test(c.path)));
      const zotero = new ZoteroLocal(origin);
      const plan = zotero.prepare('t', 'Test collection', [
        { id: 'fixture', title: 'Fixture', author: [] },
      ]);
      await assert.rejects(zotero.apply('other', plan.id), /Unknown/);
      await assert.rejects(zotero.apply('t', plan.id), /Authorize/);
      await zotero.authorize('t');
      assert.equal((await zotero.apply('t', plan.id)).state, 'complete');
      assert.equal(calls.filter((c) => c.path === '/api/users/0/collections').length, 1);
      assert.equal(calls.filter((c) => c.path === '/api/users/0/items').length, 1);
      assert.ok(!JSON.stringify(zotero.status('t')).includes('not-a-real-key'));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }));
