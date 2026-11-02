import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { Workstation } from '../electron/workstation';
const appsIndex = process.argv.indexOf('--apps');
const apps = (appsIndex < 0 ? 'office,blender,jmp' : (process.argv[appsIndex + 1] ?? '')).split(
  ',',
);
if (!apps.length || apps.some((app) => !['office', 'blender', 'jmp', 'krita'].includes(app)))
  throw new Error('Choose --apps office,blender,jmp,krita (comma-separated subset).');
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  await mkdir('.test-data', { recursive: true });
  const root = await mkdtemp(resolve('.test-data/workstation-'));
  const station = new Workstation(resolve('.runtime'), () => root);
  station.grant('test', ['office', 'blender', 'jmp', 'krita']);
  const report: any = { root, checks: [], catalog: station.catalog('test').applications };
  async function job(name: string, input: any) {
    const result = await station.invoke('test', name, input);
    const row = JSON.parse(result.content[0].text);
    for (let n = 0; n < 1200; n++) {
      const current = station.catalog('test').jobs.find((j: any) => j.id === row.id)!;
      if (current.state === 'failed') throw new Error(current.error);
      if (current.state === 'complete') return current;
      await pause(200);
    }
    throw new Error('Timed out waiting for ' + name);
  }
  try {
    if (apps.includes('office')) {
      const word = await job('office_create', {
        kind: 'word',
        title: 'Workbench Office acceptance',
        text: 'Created in Microsoft Word without modifying any existing document.',
        table: [
          ['Task', 'Status'],
          ['Native document', 'Verified'],
        ],
      });
      assert.equal(word.result.ownedInstance, true);
      const xml = strFromU8(unzipSync(await readFile(word.files[0].path))['word/document.xml']);
      assert.ok(xml.includes('Workbench Office acceptance'));
      assert.ok(xml.includes('Native document'));
      const excel = await job('office_create', {
        kind: 'spreadsheet',
        title: 'Native Excel calculation',
        headers: ['Item', 'Cost'],
        rows: [
          ['Paper', 12],
          ['Ink', 28],
        ],
        formulas: [
          { cell: 'B4', formula: '=SUM(B2:B3)' },
          { cell: 'B5', formula: '=AVERAGE(B2:B3)' },
        ],
        chart: true,
      });
      assert.deepEqual(
        excel.result.formulaResults.map((v: any) => v.value),
        [40, 20],
      );
      const entries = unzipSync(await readFile(excel.files[0].path));
      assert.ok(entries['xl/charts/chart1.xml']);
      assert.equal(excel.result.ownedInstance, true);
      report.checks.push({
        name: 'native-Word-and-Excel',
        passed: true,
        files: [...word.files, ...excel.files],
        formulaResults: excel.result.formulaResults,
      });
    }
    if (apps.includes('blender')) {
      const scene = await job('blender_create', {
        objects: [
          { kind: 'cube', name: 'Blue cube', location: [-1.5, 0, 1], color: [0.1, 0.35, 0.8, 1] },
          {
            kind: 'sphere',
            name: 'Orange sphere',
            location: [1.5, 0, 1],
            color: [1, 0.35, 0.05, 1],
          },
          { kind: 'plane', name: 'Ground', scale: [5, 5, 5], color: [0.55, 0.55, 0.55, 1] },
        ],
      });
      assert.ok(scene.result.objects.some((o: any) => o.name === 'Blue cube'));
      assert.ok(scene.result.objects.some((o: any) => o.name === 'Orange sphere'));
      assert.ok(scene.files.find((f: any) => f.name === 'scene.png').bytes > 1000);
      report.checks.push({
        name: 'native-Blender-scene-and-render',
        passed: true,
        files: scene.files,
        blender: scene.result.blender,
      });
    }
    if (apps.includes('jmp')) {
      const fit = await job('jmp_analyze', {
        points: [
          [1, 3.1],
          [2, 4.9],
          [3, 7.2],
          [4, 8.8],
          [5, 11.1],
          [6, 12.9],
        ],
      });
      assert.equal(fit.result.native.verifiedAgainstIndependentOLS, true);
      report.checks.push({
        name: 'native-JMP-scatter-and-regression',
        passed: true,
        files: fit.files,
        estimates: fit.result.estimates,
        native: fit.result.native,
        reference: fit.result.reference,
      });
    }
    if (apps.includes('krita')) {
      const rootIndex = process.argv.indexOf('--krita-root');
      if (rootIndex < 0)
        throw new Error(
          'Krita saving test needs --krita-root naming an already allowed scratch root. No roots are changed.',
        );
      const allowed = resolve(process.argv[rootIndex + 1]);
      const scratch = await mkdtemp(join(allowed, '.workbench-smoke-'));
      const invoke = async (tool: string, args: any = {}) => {
        const v = await station.invoke('test', 'krita_tools', { tool, arguments: args });
        assert.ok(!v.isError, JSON.stringify(v));
        return v;
      };
      const before = await invoke('krita_state');
      const state = JSON.parse(before.content.find((c: any) => c.type === 'text').text);
      const created = await invoke('krita_document', {
        action: 'create',
        width: 256,
        height: 256,
        name: 'Workbench isolated art check',
      });
      const current = JSON.parse(created.content.find((c: any) => c.type === 'text').text);
      const documentId = current.affected_document_id;
      report.kritaDocumentId = documentId;
      try {
        await invoke('krita_preview', { document_id: documentId });
        await invoke('krita_draw', {
          shape: 'rectangle',
          document_id: documentId,
          x: 32,
          y: 32,
          width: 192,
          height: 192,
          foreground: '#e56b2f',
          fill_style: 'ForegroundColor',
          stroke_style: 'None',
        });
        const preview = await invoke('krita_preview', { document_id: documentId });
        const png = preview.content.find((c: any) => c.type === 'image');
        assert.ok(png);
        await writeFile(join(root, 'krita-preview.png'), Buffer.from(png.data, 'base64'));
        await invoke('krita_save_export', {
          document_id: documentId,
          kra_path: join(scratch, 'art.kra'),
          png_path: join(scratch, 'art.png'),
          overwrite: false,
        });
        await copyFile(join(scratch, 'art.kra'), join(root, 'krita-master.kra'));
        await copyFile(join(scratch, 'art.png'), join(root, 'krita-art.png'));
        assert.ok(unzipSync(await readFile(join(root, 'krita-master.kra')))['mergedimage.png']);
        report.checks.push({
          name: 'native-Krita-paint-save-preview',
          passed: true,
          kra: join(root, 'krita-master.kra'),
          png: join(root, 'krita-art.png'),
        });
      } finally {
        await invoke('krita_state');
        await invoke('krita_document', {
          action: 'close',
          document_id: documentId,
          discard_changes: true,
        });
        const rel = relative(allowed, resolve(scratch));
        if (!rel || rel.startsWith('..') || isAbsolute(rel))
          throw new Error('Invalid scratch cleanup path.');
        await rm(scratch, { recursive: true, force: true });
      }
    }
    report.passed = true;
  } catch (e) {
    report.error = (e as Error).stack;
    throw e;
  } finally {
    station.close();
    await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(
      JSON.stringify(
        { report: join(root, 'report.json'), passed: report.passed, checks: report.checks },
        null,
        2,
      ) + '\n',
    );
  }
}
void main().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exitCode = 1;
});
