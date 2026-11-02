import { spawn } from 'node:child_process';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Wire } from '../shared/types';
import type { Workstation } from './workstation';
import type { WorkflowRenderer } from './workflows/renderer';
import { workspaceFile, outputDirectory, save, digest, list, bounded } from './workflows/io';
import { pdfWorkflow } from './workflows/pdf';
import { FilePlans } from './workflows/files';
import { readTable, numericPairs, csvEncode } from './workflows/tabular';
import { references, parseRis, exportResearch, ZoteroLocal } from './workflows/research';
import { ComfyWorkflows } from './workflows/comfy';
import { editAudio, wav, audacityMacro, readWav } from './workflows/audio';
import { createSvg, editSvg } from './workflows/vector';
import { TaskBrowser } from './workflows/browser';
import { PDFDocument } from 'pdf-lib';
import { text } from './application-data';
export const workflowDomains = [
  'pdf',
  'files',
  'browser',
  'reports',
  'creative',
  'research',
  'audio',
  'vector',
] as const;
export class DesktopWorkflows {
  private inkscape?: { path: string; sha256: string };
  private grants = new Map<string, Set<string>>();
  private epochs = new Map<string, number>();
  private jobs: Wire[] = [];
  private current?: { job: Wire; abort: AbortController };
  private closed = false;
  readonly plans = new FilePlans();
  readonly comfy = new ComfyWorkflows();
  readonly zotero = new ZoteroLocal();
  readonly browser: TaskBrowser;
  constructor(
    private runtime: string,
    private cwd: (id: string) => string,
    private workstation: Workstation,
    private renderer: WorkflowRenderer,
    private changed = () => {},
    private busy = (_id: string, _on: boolean) => {},
    private beforeStart = async () => {},
  ) {
    this.browser = new TaskBrowser(changed, (id) => outputDirectory(this.cwd(id)));
  }
  status(id: string) {
    return {
      granted: [...(this.grants.get(id) ?? [])],
      jobs: this.jobs
        .filter((j) => j.threadId === id)
        .map((j) => ({
          ...j,
          result: j.result ? JSON.stringify(j.result).slice(0, 6000) : undefined,
        })),
      plans: this.plans.list(id),
      browser: this.browser.status(id),
      comfy: this.comfy.status(id),
      zotero: this.zotero.status(id),
      inkscape: this.inkscape ? { path: this.inkscape.path } : undefined,
    };
  }
  grant(id: string, domains: unknown) {
    if (!Array.isArray(domains) || domains.some((v) => !workflowDomains.includes(v)))
      throw new Error('Choose the listed workflow grants.');
    this.grants.set(id, new Set(domains));
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
    if (!domains.includes('browser')) this.browser.close(id);
    if (!domains.includes('creative')) this.comfy.revoke(id);
    if (!domains.includes('research')) this.zotero.revoke(id);
    if (this.current?.job.threadId === id && !domains.includes(this.current.job.domain))
      this.cancel(id);
    this.changed();
    return this.status(id);
  }
  private assert(id: string, domain: string) {
    if (this.closed || !this.grants.get(id)?.has(domain))
      throw new Error(`Enable ${domain} workflows for this chat in Desktop & read aloud first.`);
  }
  busyFor(id: string) {
    return this.current?.job.threadId === id;
  }
  handles(name: string) {
    return [
      'workflow_status',
      'workflow_artifact',
      'document_workflow',
      'file_organize',
      'report_create',
      'creative_batch',
      'research_library',
      'zotero_read',
      'audio_edit',
      'vector_graphic',
      'browser_view',
      'browser_act',
    ].includes(name);
  }
  async invoke(id: string, name: string, input: Wire) {
    if (name === 'workflow_status') {
      const wait = bounded(input.wait_ms ?? 0, 0, 10000);
      if (!Number.isInteger(wait)) throw new Error('wait_ms must be an integer.');
      const deadline = Date.now() + wait;
      while (this.current?.job.threadId === id && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, Math.min(200, deadline - Date.now())));
      return this.wrap(this.status(id));
    }
    if (name === 'workflow_artifact') {
      const file = await this.artifact(id, text(input.job_id, 100), text(input.name, 100));
      if (file.name.endsWith('.png'))
        return {
          content: [{ type: 'image', mimeType: 'image/png', data: file.bytes.toString('base64') }],
        };
      const offset = bounded(input.offset ?? 0, 0, file.bytes.length);
      if (!Number.isInteger(offset) || !/\.(txt|md|csv|json|svg|ris)$/i.test(file.name))
        throw new Error('Choose a text/image artifact.');
      return this.wrap({
        text: file.bytes.toString('utf8').slice(offset, offset + 16000),
        offset,
        next: offset + 16000 < file.bytes.toString('utf8').length ? offset + 16000 : undefined,
      });
    }
    const domain = (
      {
        document_workflow: 'pdf',
        file_organize: 'files',
        report_create: 'reports',
        creative_batch: 'creative',
        research_library: 'research',
        zotero_read: 'research',
        audio_edit: 'audio',
        vector_graphic: 'vector',
        browser_view: 'browser',
        browser_act: 'browser',
      } as Wire
    )[name];
    this.assert(id, domain);
    if (name === 'browser_view') return this.browser.view(id);
    if (name === 'browser_act') return this.wrap(await this.browser.act(id, input));
    if (name === 'zotero_read') return this.wrap(await this.zotero.read(input));
    if (name === 'file_organize') {
      if (input.action === 'restore') {
        const result = await this.plans.restore(id, this.cwd(id), text(input.path, 4096));
        this.changed();
        return this.wrap(result);
      }
      const plan = await this.plans.preview(id, this.cwd(id), input);
      this.changed();
      return this.wrap(plan);
    }
    if (this.current) throw new Error('Wait for the active workflow or stop it first.');
    const job: Wire = {
        id: randomUUID(),
        threadId: id,
        domain,
        tool: name,
        state: 'preparing',
        createdAt: new Date().toISOString(),
        files: [],
      },
      abort = new AbortController();
    this.current = { job, abort };
    this.jobs.push(job);
    if (this.jobs.length > 30) this.jobs.shift();
    this.busy(id, true);
    this.changed();
    void this.run(job, abort, input);
    return this.wrap({
      ...job,
      instruction:
        'Use workflow_status to wait for actual completion, and workflow_artifact to inspect outputs.',
    });
  }
  private wrap(value: unknown) {
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  }
  private async run(job: Wire, abort: AbortController, input: Wire) {
    const timer = setTimeout(() => abort.abort(), 600000);
    try {
      await this.beforeStart();
      if (abort.signal.aborted) throw new Error('Stopped.');
      const root = await realpath(this.cwd(job.threadId)),
        out = await outputDirectory(root);
      job.directory = out;
      job.state = 'running';
      this.changed();
      const result = await this.perform(job, root, out, input, abort.signal);
      if (abort.signal.aborted) throw new Error('Stopped.');
      job.result = result.result;
      job.files = result.files;
      job.files.push(
        await save(out, 'workflow-result.json', JSON.stringify(result.result, null, 2)),
      );
      job.state = 'complete';
    } catch (e) {
      if (job.state !== 'stopped') {
        job.state = abort.signal.aborted ? 'stopped' : 'failed';
        job.error = String(e).slice(0, 1500);
      }
    } finally {
      clearTimeout(timer);
      if (this.current?.job === job) {
        this.current = undefined;
        this.busy(job.threadId, false);
      }
      this.changed();
    }
  }
  private async native(id: string, name: string, input: Wire, signal: AbortSignal) {
    if (signal.aborted) throw new Error('Stopped.');
    const reply = await this.workstation.invoke(id, name, input);
    if (reply.isError) throw new Error(reply.content[0]?.text);
    const row = JSON.parse(reply.content[0].text);
    if (!row.id) return row;
    const deadline = Date.now() + 200000;
    while (Date.now() < deadline) {
      if (signal.aborted) {
        this.workstation.cancel(id);
        throw new Error('Stopped while the native application may still be finishing.');
      }
      const status = this.workstation.catalog(id).jobs.find((j: Wire) => j.id === row.id);
      if (status?.state === 'complete') return status;
      if (['failed', 'stopped'].includes(status?.state)) throw new Error(status.error);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(
      'Native job exceeded its workflow deadline. Inspect existing outputs before retrying.',
    );
  }
  private async command(exe: string, args: string[], signal: AbortSignal, timeout = 45000) {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(exe, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal,
        timeout,
      });
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (data) => {
        if (stdout.length < 4 * 1024 * 1024) stdout += data;
        else child.kill();
      });
      child.stderr.on('data', (data) => {
        stderr = (stderr + data).slice(-1000);
      });
      child.once('error', reject);
      child.once('close', (code) =>
        code === 0
          ? resolve(stdout)
          : reject(new Error(stdout.slice(-1500) || stderr || 'Application helper failed.')),
      );
    });
  }
  private async ocr(path: string, out: string, signal: AbortSignal) {
    if (process.platform !== 'win32')
      throw new Error(
        'Offline OCR currently uses Windows OCR and an installed recognition language; other PDF operations work on all platforms.',
      );
    const script = join(this.runtime, 'document-worker.ps1'),
      meta = JSON.parse(await readFile(join(this.runtime, 'document-worker.json'), 'utf8'));
    if (digest(await readFile(script)) !== meta.sha256)
      throw new Error('OCR helper integrity check failed.');
    const input = join(out, 'ocr-' + randomUUID() + '.json');
    await writeFile(input, JSON.stringify({ path }), { flag: 'wx' });
    const result = JSON.parse(
      await this.command(
        join(process.env.WINDIR ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-File', script, '-InputFile', input],
        signal,
      ),
    );
    if (result.error) throw new Error(result.error);
    return result;
  }
  private async perform(
    job: Wire,
    root: string,
    out: string,
    input: Wire,
    signal: AbortSignal,
  ): Promise<{ files: Wire[]; result: Wire }> {
    const id = job.threadId;
    if (job.tool === 'document_workflow') {
      if (!['extract', 'ocr'].includes(input.action)) return pdfWorkflow(root, out, input);
      const source = await workspaceFile(root, text(input.paths?.[0], 4096));
      const files: Wire[] = [],
        pages: Wire[] = [];
      if (source.path.toLowerCase().endsWith('.pdf')) {
        const rendered = await this.renderer.request('pdf', source.bytes.toString('base64'), {
          pages: input.pages,
          columns: input.columns,
          raster: input.action === 'ocr',
        });
        for (const page of rendered.pages) {
          if (signal.aborted) throw new Error('Stopped.');
          if (input.action === 'ocr') {
            const image = await save(
              out,
              `scan-page-${page.page}.png`,
              Buffer.from(page.png, 'base64'),
            );
            files.push(image);
            const result = await this.ocr(image.path, out, signal);
            pages.push({ page: page.page, ...result });
          } else pages.push(page);
        }
      } else {
        if (input.action !== 'ocr' || !/\.(png|jpe?g)$/i.test(source.path))
          throw new Error('OCR supports PDF/PNG/JPEG; extraction supports PDF.');
        pages.push({ page: 1, ...(await this.ocr(source.path, out, signal)) });
      }
      const content = pages.map((p) => p.text).join('\n\n');
      if (!content.trim()) throw new Error('No text was recognized.');
      files.push(await save(out, 'extracted.txt', content));
      for (const page of pages)
        if (page.rows)
          files.push(await save(out, `table-page-${page.page}.csv`, csvEncode(page.rows)));
      return {
        files,
        result: {
          sourceSha256: source.sha256,
          pages: pages.map(({ png, ...p }: Wire) => p),
          notice:
            'OCR and layout-derived tables require review before numerical analysis or citation.',
        },
      };
    }
    if (job.tool === 'report_create') {
      const data = await readTable(root, text(input.path, 4096), input.sheet ?? 1),
        points = numericPairs(data.rows, text(input.x, 100), text(input.y, 100));
      if (input.include_workbook && points.length > 2000)
        throw new Error('Workbook reports support at most 2,000 data rows.');
      const analysis = await this.native(id, 'jmp_analyze', { points }, signal);
      const verified = analysis.result.native;
      if (!verified.verifiedAgainstIndependentOLS)
        throw new Error('Native estimates were not independently verified.');
      const residualRows = points.map(([x, y]) => [
        x,
        y,
        verified.intercept + verified.slope * x,
        y - verified.intercept - verified.slope * x,
      ]);
      const residualPlot = await this.native(
        id,
        'jmp_analyze',
        { points: residualRows.map((row) => [row[0], row[3]]) },
        signal,
      );
      const residualGraph = residualPlot.files.find((f: Wire) => f.name === 'regression.png');
      const narrative = `Source: ${basename(data.source)}\nSource SHA-256: ${data.sha256}\nRows analyzed: ${points.length}. No missing/nonnumeric rows were silently dropped.\nResponse: ${input.y}; predictor: ${input.x}.\nNative JMP OLS: y = ${verified.intercept} + ${verified.slope} x.\nIndependent R-squared: ${analysis.result.reference.rSquared}; residual RMSE: ${analysis.result.reference.rmse}.\nThese numerical checks do not verify independence, linearity, residual normality, constant variance, causality or the scientific interpretation.`;
      const title = text(input.title ?? 'Scientific analysis report', 300),
        graph = analysis.files.find((f: Wire) => f.name === 'regression.png');
      const doc = await this.native(
        id,
        'office_create',
        {
          kind: 'word',
          title,
          text: narrative,
          table: [
            ['Quantity', 'Value'],
            ['Slope', String(verified.slope)],
            ['Intercept', String(verified.intercept)],
            ['N', String(points.length)],
          ],
          images: [graph?.path, residualGraph?.path].filter(Boolean),
        },
        signal,
      );
      const files: Wire[] = [
        await save(out, 'analysis-data.csv', csvEncode([[input.x, input.y], ...points])),
        await save(
          out,
          'residuals.csv',
          csvEncode([[input.x, input.y, 'fitted', 'residual'], ...residualRows]),
        ),
      ];
      if (residualGraph)
        files.push(
          await save(out, 'residuals.png', (await workspaceFile(root, residualGraph.path)).bytes),
        );
      for (const file of [...analysis.files, ...doc.files]) {
        const source = await workspaceFile(root, file.path);
        files.push(await save(out, file.name, source.bytes));
      }
      if (input.include_workbook) {
        const workbook = await this.native(
          id,
          'office_create',
          { kind: 'spreadsheet', headers: [input.x, input.y], rows: points, chart: true, title },
          signal,
        );
        for (const f of workbook.files)
          files.push(await save(out, f.name, (await workspaceFile(root, f.path)).bytes));
      }
      if (input.include_slides) {
        const slides = await this.native(
          id,
          'office_create',
          {
            kind: 'presentation',
            title,
            slides: [
              { title, text: narrative.slice(0, 600) },
              {
                title: 'Interpretation limits',
                text: 'Review residual plots and scientific assumptions before interpreting the fit. Numerical agreement does not establish causation.',
              },
            ],
            pdf: true,
          },
          signal,
        );
        for (const f of slides.files)
          files.push(await save(out, f.name, (await workspaceFile(root, f.path)).bytes));
      }
      return {
        files,
        result: {
          source: data.source,
          sourceSha256: data.sha256,
          points: points.length,
          native: verified,
          reference: analysis.result.reference,
          residualDiagnostics: {
            mean: residualRows.reduce((sum, row) => sum + row[3], 0) / points.length,
            maxAbsolute: Math.max(...residualRows.map((row) => Math.abs(row[3]))),
            plot: 'Residuals versus source x, generated in native JMP; not an assumptions test.',
          },
          narrative,
        },
      };
    }
    if (job.tool === 'creative_batch') {
      if (input.kind === 'comfy') return this.comfy.run(id, root, out, input, signal);
      if (input.kind === 'blender') {
        const files: Wire[] = [],
          results: Wire[] = [];
        for (const [i, variant] of list<Wire>(input.scenes ?? input.variants, 6).entries()) {
          const native = await this.native(id, 'blender_create', variant, signal);
          results.push(native.result);
          for (const f of native.files)
            files.push(
              await save(
                out,
                `variant-${i + 1}-${f.name}`,
                (await workspaceFile(root, f.path)).bytes,
              ),
            );
        }
        return { files, result: { variants: results } };
      }
      if (input.kind === 'krita') {
        const results: Wire[] = [];
        for (const document of list<Wire>(input.documents, 4)) {
          if (signal.aborted) throw new Error('Stopped.');
          const reply = await this.workstation.invoke(id, 'krita_tools', {
            tool: 'krita_save_export',
            arguments: {
              document_id: document.document_id,
              kra_path: document.kra_path,
              png_path: document.png_path,
              overwrite: false,
            },
          });
          if (reply.isError) throw new Error(reply.content[0]?.text);
          results.push(reply);
        }
        return {
          files: [],
          result: {
            exports: results,
            notice:
              'Native Krita allowed roots are unchanged; only this chat’s documents were exported.',
          },
        };
      }
      throw new Error('Choose blender, krita or comfy creative batching.');
    }
    if (job.tool === 'research_library') {
      let items: Wire[];
      if (input.path) {
        const source = await workspaceFile(root, text(input.path, 4096), 4 * 1024 * 1024);
        items = source.path.toLowerCase().endsWith('.ris')
          ? parseRis(source.bytes.toString())
          : references(JSON.parse(source.bytes.toString()));
      } else items = references(input.items);
      if (input.prepare_zotero === true) {
        const review = this.zotero.prepare(id, text(input.title ?? 'Research library', 200), items);
        this.changed();
        return { files: [], result: { review } };
      }
      const result = await exportResearch(out, items, input.annotations ?? []);
      if (input.word_report) {
        const citedNotes = await readFile(
          result.files.find((f) => f.name === 'cited-notes.md')!.path,
          'utf8',
        );
        const native = await this.native(
          id,
          'office_create',
          {
            kind: 'word',
            title: input.title ?? 'Research bibliography',
            text: result.result.bibliography + '\n\nCited notes\n\n' + citedNotes,
          },
          signal,
        );
        for (const f of native.files)
          result.files.push(await save(out, f.name, (await workspaceFile(root, f.path)).bytes));
      }
      return result;
    }
    if (job.tool === 'audio_edit') {
      const tracks: Buffer[] = [];
      for (const path of list<string>(input.paths, 20)) {
        const source = await workspaceFile(root, path);
        if (source.path.toLowerCase().endsWith('.wav')) tracks.push(source.bytes);
        else if (/\.(mp3|m4a|ogg|flac)$/i.test(source.path)) {
          const decoded = await this.renderer.request('audio', source.bytes.toString('base64'));
          tracks.push(wav(Buffer.from(decoded.samples, 'base64'), decoded.rate, decoded.channels));
        } else
          throw new Error(
            'Choose WAV or a format supported by the installed Chromium audio decoder.',
          );
      }
      const audio = editAudio(tracks, input),
        files = [await save(out, 'edited.wav', audio.bytes)];
      files.push(
        await save(
          out,
          'audacity-import.txt',
          audacityMacro(files[0].path, input.normalize_db ?? -3),
        ),
      );
      let backend: Wire = { backend: 'Workbench PCM editing' };
      if (input.backend === 'audacity') {
        const path = join(out, 'audacity-export.wav');
        if (process.platform !== 'win32')
          throw new Error(
            'Audacity pipe integration requires Windows; the built-in audio backend works on every platform.',
          );
        const helper = join(this.runtime, 'application-worker.exe'),
          meta = JSON.parse(await readFile(join(this.runtime, 'application-worker.json'), 'utf8'));
        if (digest(await readFile(helper)) !== meta.sha256)
          throw new Error('Application helper integrity check failed.');
        const request = join(out, 'audacity-input.json');
        await writeFile(
          request,
          JSON.stringify({
            operation: 'audacity',
            source: files[0].path,
            path,
            peak: input.normalize_db ?? -3,
          }),
          { flag: 'wx' },
        );
        const reply = JSON.parse(
          (await this.command(helper, [request], signal, 100000)).trim().split('\n').at(-1)!,
        );
        if (reply.error) throw new Error(reply.error);
        backend = reply.result;
        const source = await workspaceFile(root, path, 40 * 1024 * 1024);
        readWav(source.bytes);
        files.push({ name: 'audacity-export.wav', path, bytes: source.bytes.length });
      }
      return {
        files,
        result: {
          ...backend,
          seconds: audio.seconds,
          rate: audio.rate,
          channels: audio.channels,
          gain: audio.gain,
          peakBefore: audio.peakBefore,
          peakAfter: audio.peakAfter,
        },
      };
    }
    if (job.tool === 'vector_graphic') {
      let svg: string;
      if (input.path) {
        const source = await workspaceFile(root, text(input.path, 4096), 2 * 1024 * 1024);
        svg = editSvg(source.bytes.toString('utf8'), input.edits);
      } else svg = createSvg(input);
      const files: Wire[] = [await save(out, 'drawing.svg', svg)];
      if (input.backend === 'inkscape') {
        if (!this.inkscape || digest(await readFile(this.inkscape.path)) !== this.inkscape.sha256)
          throw new Error('Select the installed Inkscape executable in the workflow panel first.');
        for (const size of list<Wire>(input.sizes ?? [{ width: 800, height: 600 }], 8)) {
          const width = bounded(size.width, 16, 4096),
            height = bounded(size.height, 16, 4096),
            name = `drawing-${width}x${height}.png`,
            path = join(out, name);
          await this.command(
            this.inkscape.path,
            [
              files[0].path,
              '--export-type=png',
              '--export-filename=' + path,
              '--export-width=' + width,
              '--export-height=' + height,
            ],
            signal,
          );
          const image = await workspaceFile(root, path);
          if (image.bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
            throw new Error('Inkscape did not produce a PNG.');
          files.push({ name, path, bytes: image.bytes.length });
        }
        if (input.pdf) {
          const path = join(out, 'drawing.pdf');
          await this.command(
            this.inkscape.path,
            [files[0].path, '--export-type=pdf', '--export-filename=' + path],
            signal,
          );
          const pdf = await workspaceFile(root, path);
          await PDFDocument.load(pdf.bytes);
          files.push({ name: 'drawing.pdf', path, bytes: pdf.bytes.length });
        }
        return {
          files,
          result: {
            backend: 'Inkscape',
            editable: 'drawing.svg',
            notice: 'Native Inkscape PNG/vector-PDF exports from the preserved editable SVG.',
          },
        };
      }
      for (const size of list<Wire>(input.sizes ?? [{ width: 800, height: 600 }], 8)) {
        const rendered = await this.renderer.request(
          'svg',
          Buffer.from(svg).toString('base64'),
          size,
        );
        files.push(
          await save(
            out,
            `drawing-${size.width}x${size.height}.png`,
            Buffer.from(rendered.png, 'base64'),
          ),
        );
      }
      if (input.pdf === true) {
        const pdf = await PDFDocument.create(),
          png = await pdf.embedPng((await workspaceFile(root, files[1].path)).bytes),
          page = pdf.addPage([png.width, png.height]);
        page.drawImage(png, { x: 0, y: 0, width: png.width, height: png.height });
        files.push(await save(out, 'drawing.pdf', await pdf.save()));
      }
      return {
        files,
        result: {
          editable: 'drawing.svg',
          exports: files.map((f) => f.name),
          notice:
            'SVG stays editable. PDF export embeds a raster preview; use Inkscape for a vector PDF.',
        },
      };
    }
    throw new Error('Unknown workflow.');
  }
  async artifact(id: string, jobId: string, name: string) {
    const job = this.jobs.find((j) => j.id === jobId && j.threadId === id),
      file = job?.files.find((f: Wire) => f.name === name);
    if (!file) throw new Error('Unknown artifact for this chat.');
    return { ...(await workspaceFile(this.cwd(id), file.path, 40 * 1024 * 1024)), name };
  }
  async reviewFiles(id: string, planId: string, hash: string, undo = false) {
    this.assert(id, 'files');
    const epoch = this.epochs.get(id);
    const result = await this.plans.review(
      id,
      planId,
      hash,
      undo,
      () => this.epochs.get(id) === epoch && !!this.grants.get(id)?.has('files'),
    );
    this.changed();
    return result;
  }
  async openBrowser(id: string, url: string) {
    this.assert(id, 'browser');
    return this.browser.open(id, url);
  }
  async approveComfy(id: string, path: string, origin: string) {
    this.assert(id, 'creative');
    const epoch = this.epochs.get(id);
    const result = await this.comfy.approve(id, this.cwd(id), path, origin);
    if (this.epochs.get(id) !== epoch) {
      this.comfy.revoke(id);
      throw new Error('Workflow grant changed during approval.');
    }
    this.changed();
    return result;
  }
  async authorizeZotero(id: string) {
    this.assert(id, 'research');
    const epoch = this.epochs.get(id),
      result = await this.zotero.authorize(id);
    if (this.epochs.get(id) !== epoch) {
      this.zotero.revoke(id);
      throw new Error('Research grant changed during authorization.');
    }
    return result;
  }
  async applyZotero(id: string, planId: string) {
    this.assert(id, 'research');
    const result = await this.zotero.apply(id, planId);
    this.changed();
    return result;
  }
  async submitBrowser(id: string, reviewId: string) {
    this.assert(id, 'browser');
    return this.browser.submit(id, reviewId);
  }
  async configureInkscape(id: string, path: string) {
    this.assert(id, 'vector');
    const { stat } = await import('node:fs/promises');
    const resolved = await realpath(path);
    if (!/^inkscape(?:\.exe)?$/i.test(basename(resolved)) || !(await stat(resolved)).isFile())
      throw new Error('Select the installed Inkscape executable.');
    this.inkscape = { path: resolved, sha256: digest(await readFile(resolved)) };
    this.changed();
    return { path: resolved };
  }
  cancel(id?: string) {
    for (const key of id ? [id] : this.epochs.keys())
      this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
    const active = this.current;
    if (active && (!id || id === active.job.threadId)) {
      active.job.state = 'stopped';
      active.job.error =
        'Stopped. Native application/service work already delivered may still finish; inspect outputs before retrying.';
      active.abort.abort();
      this.workstation.cancel(active.job.threadId);
      this.changed();
    }
  }
  revoke(id?: string) {
    this.cancel(id);
    if (id) this.grants.delete(id);
    else this.grants.clear();
    this.comfy.revoke(id);
    this.zotero.revoke(id);
    this.browser.close(id);
    this.changed();
  }
  close() {
    this.closed = true;
    this.revoke();
    this.renderer.close();
  }
}
