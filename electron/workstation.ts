import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile, readFile, stat, realpath } from 'node:fs/promises';
import { join, delimiter, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { insideFuture } from './paths';
import { RpcProcess } from './rpc';
import {
  officeInput,
  regressionInput,
  jmpScript,
  verifyJmpEstimates,
  blenderInput,
  blenderScript,
  shoppingPlan,
  chessPosition,
  text,
} from './application-data';
import type { Wire } from '../shared/types';
import { Practice } from './practice';
import { unzipSync } from 'fflate';
import { previewFile } from './document-preview';

export type Application = 'office' | 'blender' | 'jmp' | 'krita';
export class Workstation {
  private grants = new Map<string, Set<string>>();
  private grantEpoch = new Map<string, number>();
  private jobs: Wire[] = [];
  private audit: Wire[] = [];
  private current?: { job: Wire; child?: ChildProcess; owned?: Wire[] };
  private krita?: RpcProcess;
  private kritaReady?: Promise<RpcProcess>;
  private kritaTail: Promise<unknown> = Promise.resolve();
  private documents = new Map<string, Set<string>>();
  private previousKritaDocument = new Map<string, string>();
  private practices = new Map<string, Practice>();
  private closed = false;
  constructor(
    private runtime: string,
    private cwd: (id: string) => string,
    private changed = () => {},
    private busy = (_id: string, _on: boolean) => {},
    private beforeStart = async () => {},
  ) {}
  private executable(name: string) {
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files',
      local = process.env.LOCALAPPDATA ?? '';
    const paths: Record<string, string[]> = {
      word: [join(pf, 'Microsoft Office/root/Office16/WINWORD.EXE')],
      excel: [join(pf, 'Microsoft Office/root/Office16/EXCEL.EXE')],
      jmp: [join(pf, 'SAS/JMP/16/jmp.exe')],
      krita: [join(pf, 'Krita (x64)/bin/krita.exe')],
      lucas: [join(local, 'Programs/LucasChessR/bin/LucasR.exe')],
      blender: [],
    };
    const blenderRoot = join(pf, 'Blender Foundation');
    if (existsSync(blenderRoot))
      paths.blender = readdirSync(blenderRoot)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .map((p) => join(blenderRoot, p, 'blender.exe'));
    if (name === 'uvx') {
      const folders = (process.env.PATH ?? '').split(delimiter);
      const winget = join(local, 'Microsoft/WinGet/Packages');
      if (existsSync(winget))
        folders.push(
          ...readdirSync(winget)
            .filter((n) => n.startsWith('astral-sh.uv_'))
            .map((n) => join(winget, n)),
        );
      return folders.map((p) => join(p, 'uvx.exe')).find(existsSync);
    }
    return paths[name]?.find(existsSync);
  }
  catalog(id: string): Wire {
    return {
      supported: process.platform === 'win32',
      granted: [...(this.grants.get(id) ?? [])],
      kritaDocuments: [...(this.documents.get(id) ?? [])],
      audit: this.audit.filter((a) => a.threadId === id),
      applications: ['word', 'excel', 'blender', 'krita', 'jmp', 'lucas'].map((name) => ({
        name,
        installed: !!this.executable(name),
        path: this.executable(name),
      })),
      jobs: this.jobs.filter((j) => j.threadId === id).map((j) => ({ ...j, files: [...j.files] })),
    };
  }
  grant(id: string, applications: unknown) {
    if (
      !Array.isArray(applications) ||
      applications.some((a) => !['office', 'blender', 'jmp', 'krita'].includes(a))
    )
      throw new Error('Choose Office, Blender, JMP or Krita.');
    this.grants.set(id, new Set(applications));
    this.grantEpoch.set(id, (this.grantEpoch.get(id) ?? 0) + 1);
    if (
      this.current?.job.threadId === id &&
      !this.grants.get(id)!.has(this.current.job.application)
    )
      this.cancel(id);
    this.changed();
    return this.catalog(id);
  }
  busyFor(id: string) {
    return this.current?.job.threadId === id;
  }
  async practice(id: string) {
    if (this.closed) throw new Error('Workbench is closing.');
    if (!this.practices.has(id)) {
      if (this.practices.size >= 4)
        throw new Error(
          'Up to four practice sessions can run at once. Restart Workbench to clear unused sessions.',
        );
      const practice = new Practice();
      await practice.start();
      this.practices.set(id, practice);
    }
    return this.practices.get(id)!.url;
  }
  private assert(id: string, app: string) {
    if (process.platform !== 'win32')
      throw new Error('Application integrations currently require Windows.');
    if (!this.grants.get(id)?.has(app))
      throw new Error(
        `Enable ${app} application tools for this chat in Desktop & read aloud first.`,
      );
  }
  handles(name: string) {
    return [
      'application_catalog',
      'application_jobs',
      'application_preview',
      'office_create',
      'blender_create',
      'jmp_analyze',
      'krita_tools',
      'chess_position',
      'shopping_plan',
    ].includes(name);
  }
  async invoke(id: string, name: string, input: Wire): Promise<Wire> {
    if (this.closed) throw new Error('Workbench is closing.');
    const audit: Wire = {
      threadId: id,
      name,
      tool:
        name === 'krita_tools' && typeof input.tool === 'string'
          ? input.tool.slice(0, 100)
          : undefined,
      time: new Date().toISOString(),
      status: 'running',
    };
    this.audit.push(audit);
    if (this.audit.length > 200) this.audit.shift();
    try {
      const result = await this.perform(id, name, input);
      audit.status = result.isError ? 'failed' : 'completed';
      return result;
    } catch (e) {
      audit.status = 'failed';
      throw e;
    }
  }
  private async perform(id: string, name: string, input: Wire): Promise<Wire> {
    if (!this.handles(name)) throw new Error('Unknown application tool.');
    if (name === 'application_catalog') return this.wrap(this.catalog(id));
    if (name === 'application_jobs') return this.wrap(this.catalog(id).jobs);
    if (name === 'application_preview') {
      const path = await this.file(id, text(input.job_id, 100), text(input.name, 100));
      if (!path.toLowerCase().endsWith('.png'))
        throw new Error('Application previews support PNG artifacts only.');
      const preview = await previewFile(this.cwd(id), path);
      if (preview.kind !== 'image') throw new Error('Artifact is not a supported image.');
      if (preview.data.length > 8 * 1024 * 1024)
        throw new Error('Application preview exceeds the 8 MiB encoded-image limit.');
      return { content: [{ type: 'image', mimeType: preview.mimeType, data: preview.data }] };
    }
    if (name === 'shopping_plan') return this.wrap(shoppingPlan(input));
    if (name === 'chess_position') {
      const result = chessPosition(input);
      if (input.export === true) {
        const root = await this.output(id);
        const path = join(root, 'game.pgn');
        await writeFile(path, result.pgn + '\n', { flag: 'wx' });
        return this.wrap({ ...result, path });
      }
      return this.wrap(result);
    }
    if (name === 'krita_tools') return this.kritaTool(id, input);
    const app = name === 'office_create' ? 'office' : name === 'blender_create' ? 'blender' : 'jmp';
    this.assert(id, app);
    if (this.current) throw new Error('Wait for the active application job or cancel it first.');
    const data =
      app === 'office'
        ? officeInput(input)
        : app === 'blender'
          ? blenderInput(input)
          : regressionInput(input);
    const job: Wire = {
      id: randomUUID(),
      threadId: id,
      application: app,
      state: 'preparing',
      files: [],
      createdAt: new Date().toISOString(),
    };
    const active = { job, child: undefined as ChildProcess | undefined };
    this.current = active;
    this.jobs.push(job);
    if (this.jobs.length > 30) this.jobs.shift();
    this.busy(id, true);
    this.changed();
    void this.run(active, data);
    return this.wrap({
      ...job,
      instruction:
        'Application work is running separately. Use application_jobs to inspect actual completion and results. Do not report success before state=complete.',
    });
  }
  private wrap(value: unknown) {
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  }
  private async output(id: string) {
    const root = await insideFuture(this.cwd(id), 'workbench-output');
    await mkdir(root, { recursive: true });
    const path = join(root, randomUUID());
    await mkdir(path);
    return path;
  }
  private worker() {
    const path = join(this.runtime, 'application-worker.exe');
    const meta = JSON.parse(readFileSync(join(this.runtime, 'application-worker.json'), 'utf8'));
    if (createHash('sha256').update(readFileSync(path)).digest('hex') !== meta.sha256)
      throw new Error('Application helper checksum mismatch. Rebuild/reinstall Workbench.');
    return path;
  }
  private async run(active: { job: Wire; child?: ChildProcess; owned?: Wire[] }, data: Wire) {
    const { job } = active;
    try {
      await this.beforeStart();
      if (this.current !== active) return;
      const root = await this.output(job.threadId);
      job.directory = root;
      let exe: string | undefined, args: string[], input: Wire;
      if (job.application === 'office') {
        if (!this.executable(data.operation === 'word' ? 'word' : 'excel'))
          throw new Error(
            'Microsoft Word/Excel was not found in the supported Office installation path.',
          );
        input = {
          ...data,
          path: join(root, data.operation === 'word' ? 'document.docx' : 'workbook.xlsx'),
        };
        exe = this.worker();
        args = [join(root, 'input.json')];
      } else if (job.application === 'blender') {
        exe = this.executable('blender');
        if (!exe) throw new Error('Blender was not found.');
        input = data;
        await writeFile(join(root, 'scene.py'), blenderScript, { flag: 'wx' });
        args = [
          '--background',
          '--factory-startup',
          '--python',
          join(root, 'scene.py'),
          '--',
          root,
        ];
      } else {
        if (!this.executable('jmp')) throw new Error('JMP 16 was not found.');
        await writeFile(join(root, 'analysis.jsl'), jmpScript(data, root), { flag: 'wx' });
        input = { operation: 'jmp', script: join(root, 'analysis.jsl') };
        exe = this.worker();
        args = [join(root, 'input.json')];
        job.reference = data.reference;
      }
      await writeFile(join(root, 'input.json'), JSON.stringify(input), { flag: 'wx' });
      if (this.current !== active) return;
      job.state = 'running';
      this.changed();
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(exe!, args, {
          cwd: root,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        active.child = child;
        let stdout = '',
          pending = '';
        child.stdout?.on('data', (part) => {
          if (stdout.length < 1000000) stdout += part;
          pending += part;
          let end;
          while ((end = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, end);
            pending = pending.slice(end + 1);
            try {
              const owned = JSON.parse(line).ownedProcess;
              if (
                owned &&
                ['WINWORD', 'EXCEL'].includes(owned.name) &&
                Number.isInteger(owned.pid) &&
                owned.pid > 0 &&
                /^\d+$/.test(owned.started)
              ) {
                (active.owned ??= []).push(owned);
                if (job.state === 'stopped') {
                  this.cleanup([owned]);
                  child.kill();
                }
              }
            } catch {}
          }
        });
        child.stderr?.resume();
        const timer = setTimeout(() => {
          child.kill();
          reject(
            new Error(
              'Application job timed out. Inspect its output before retrying; the native application may still be processing.',
            ),
          );
        }, 180000);
        child.once('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          code === 0
            ? resolve(stdout)
            : reject(
                new Error(stdout.trim().slice(-1200) || `Application helper exited (${code}).`),
              );
        });
      });
      if (this.current !== active) return;
      if (job.application === 'office') {
        const reply = JSON.parse(output.trim().split('\n').at(-1)!);
        if (reply.error) throw new Error(reply.error);
        job.result = reply.result;
        const entries = unzipSync(await readFile(input.path));
        const required = data.operation === 'word' ? 'word/document.xml' : 'xl/workbook.xml';
        if (!entries[required]?.length || !entries['[Content_Types].xml']?.length)
          throw new Error('Office output is not a complete OpenXML package.');
        job.files = [{ name: basename(input.path), path: input.path }];
      } else if (job.application === 'blender') {
        job.result = JSON.parse(await readFile(join(root, 'scene.json'), 'utf8'));
        job.files = ['scene.blend', 'scene.png', 'scene.json'].map((name) => ({
          name,
          path: join(root, name),
        }));
      } else {
        if (existsSync(join(root, 'error.txt')))
          throw new Error((await readFile(join(root, 'error.txt'), 'utf8')).slice(0, 1500));
        if (!existsSync(join(root, 'complete.txt')))
          throw new Error(
            'JMP did not produce its completion marker. Inspect the saved JSL and the native JMP log.',
          );
        const estimates = await readFile(join(root, 'estimates.csv'), 'utf8');
        const native = verifyJmpEstimates(estimates, data.reference);
        job.result = {
          estimates,
          native,
          reference: data.reference,
          notice:
            'Native coefficients agree with an independent OLS calculation. This does not verify model assumptions or scientific interpretation.',
        };
        const script = await readFile(join(root, 'reproduce.jsl'), 'utf8');
        await writeFile(
          join(root, 'reproduce.jsl'),
          '//!\nOpen(' +
            JSON.stringify(join(root, 'data.jmp').replace(/\\/g, '/')) +
            ');\n' +
            script +
            ';\n',
        );
        job.files = ['regression.png', 'estimates.csv', 'data.jmp', 'reproduce.jsl'].map(
          (name) => ({ name, path: join(root, name) }),
        );
      }
      for (const file of job.files) {
        const info = await stat(file.path);
        if (!info.size) throw new Error('Application produced an empty artifact.');
        file.bytes = info.size;
      }
      job.state = 'complete';
    } catch (e) {
      if (this.current === active) {
        job.state = 'failed';
        job.error = (e as Error).message;
      }
    } finally {
      if (job.state === 'failed') this.cleanup(active.owned);
      if (this.current === active) {
        this.current = undefined;
        this.busy(job.threadId, false);
        this.changed();
      }
    }
  }
  private cleanup(owned: Wire[] = []) {
    for (const item of owned) {
      try {
        const child = spawn(
          this.worker(),
          ['--stop-owned', String(item.pid), item.started, item.name],
          { windowsHide: true, stdio: 'ignore' },
        );
        child.on('error', () => {});
      } catch {}
    }
  }
  cancel(id?: string) {
    const active = this.current;
    if (active && (!id || active.job.threadId === id)) {
      this.current = undefined;
      active.job.state = 'stopped';
      if (active.job.application === 'blender' || active.owned?.length) active.child?.kill();
      this.cleanup(active.owned);
      active.job.error =
        'Stopped. An in-flight native application operation may still finish; inspect its artifacts before retrying.';
      this.busy(active.job.threadId, false);
      this.changed();
    }
  }
  revoke(id?: string) {
    this.cancel(id);
    if (id) {
      this.grants.delete(id);
      this.grantEpoch.set(id, (this.grantEpoch.get(id) ?? 0) + 1);
    } else {
      for (const key of this.grants.keys())
        this.grantEpoch.set(key, (this.grantEpoch.get(key) ?? 0) + 1);
      this.grants.clear();
    }
    this.changed();
  }
  async file(id: string, jobId: string, name: string) {
    const job = this.jobs.find((j) => j.id === jobId && j.threadId === id);
    const file = job?.files.find((f: Wire) => f.name === name);
    if (!file) throw new Error('Unknown application artifact.');
    const canonical = await realpath(file.path);
    if (
      canonical !== file.path ||
      !['.docx', '.xlsx', '.blend', '.png', '.csv', '.jmp', '.pgn', '.json'].some((ext) =>
        file.path.toLowerCase().endsWith(ext),
      )
    )
      throw new Error('Artifact changed or cannot be opened from this panel.');
    return file.path;
  }
  async launch(name: string) {
    const path = this.executable(name);
    if (!path) throw new Error('Application is not installed in a supported location.');
    const child = spawn(path, [], { detached: true, stdio: 'ignore', windowsHide: false });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
  }
  private async connectKrita() {
    if (this.closed) throw new Error('Workbench is closing.');
    if (this.krita) return this.krita;
    if (this.kritaReady) return this.kritaReady;
    this.kritaReady = (async () => {
      const exe = this.executable('uvx');
      if (!exe) throw new Error('Install/configure the Krita MCP server first; uvx was not found.');
      const rpc = new RpcProcess(
        exe,
        ['--offline', '--from', 'krita-codex-mcp==0.2.2', 'krita-codex-mcp'],
        process.cwd(),
      );
      try {
        await rpc.request(
          'initialize',
          {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'grok-workbench', version: '0.8.5' },
          },
          60000,
        );
        if (this.closed) throw new Error('Workbench is closing.');
        rpc.notify('notifications/initialized', {});
        this.krita = rpc;
        return rpc;
      } catch (e) {
        rpc.close();
        throw e;
      }
    })().finally(() => {
      this.kritaReady = undefined;
    });
    return this.kritaReady;
  }
  private kritaTool(id: string, input: Wire): Promise<Wire> {
    this.assert(id, 'krita');
    const epoch = this.grantEpoch.get(id);
    const allowed = () => {
      this.assert(id, 'krita');
      if (this.grantEpoch.get(id) !== epoch)
        throw new Error('The application grant changed; inspect state before continuing.');
    };
    const run = async () => {
      allowed();
      const rpc = await this.connectKrita();
      if (!input.tool) {
        const inventory = await rpc.request('tools/list');
        const query = text(input.query ?? '', 100).toLowerCase();
        return this.wrap(
          inventory.tools
            .filter(
              (t: Wire) => !query || `${t.name} ${t.description}`.toLowerCase().includes(query),
            )
            .slice(0, 12),
        );
      }
      const tool = text(input.tool, 100),
        args = { ...(input.arguments ?? {}) };
      if (
        !/^krita_(state|preview|document|canvas|layers|brush|paint_path|draw|color|history|save_export|edit)$/.test(
          tool,
        )
      )
        throw new Error('Unsupported Krita operation.');
      if (tool === 'krita_document') {
        args.action ??= 'list';
        if (!['list', 'compatibility', 'create', 'activate', 'close'].includes(args.action))
          throw new Error(
            'This integration creates new Krita documents only. Use krita_save_export with new paths to save artwork.',
          );
        if (args.action === 'create') {
          const width = args.width ?? 1920,
            height = args.height ?? 1080;
          if (
            !Number.isInteger(width) ||
            !Number.isInteger(height) ||
            width < 1 ||
            height < 1 ||
            width > 4096 ||
            height > 4096
          )
            throw new Error('New Krita canvases support dimensions from 1 to 4096 pixels.');
          if ((this.documents.get(id)?.size ?? 0) >= 4)
            throw new Error(
              'Close or save your existing chat-created Krita documents before creating more (limit four).',
            );
        }
      }
      const readOnly =
        tool === 'krita_state' ||
        (tool === 'krita_document' && ['list', 'compatibility'].includes(args.action));
      const create = tool === 'krita_document' && args.action === 'create';
      if (create && !this.previousKritaDocument.has(id)) {
        const state = await rpc.request(
          'tools/call',
          { name: 'krita_state', arguments: {} },
          30000,
        );
        const value = JSON.parse(state.content.find((c: Wire) => c.type === 'text')?.text ?? '{}');
        if (value.document_id) this.previousKritaDocument.set(id, value.document_id);
      }
      if (!readOnly && !create) {
        const state = await rpc.request(
          'tools/call',
          { name: 'krita_state', arguments: {} },
          30000,
        );
        const value = JSON.parse(state.content.find((c: Wire) => c.type === 'text')?.text ?? '{}');
        const documentId = args.document_id ?? value.document_id;
        if (!this.documents.get(id)?.has(documentId))
          throw new Error(
            'Krita writes/previews are scoped to documents created by this chat. Create a new document first; existing user artwork is preserved.',
          );
        args.document_id = documentId;
      }
      if (tool === 'krita_save_export' && args.overwrite === true)
        throw new Error(
          'Use a new output path; this integration does not overwrite existing artwork.',
        );
      try {
        allowed();
        const result = await rpc.request('tools/call', { name: tool, arguments: args }, 210000);
        if (create && !result.isError) {
          const value = JSON.parse(
            result.content.find((c: Wire) => c.type === 'text')?.text ?? '{}',
          );
          const doc =
            value.affected_document_id ?? value.document_id ?? value.document?.document_id;
          if (doc) {
            if (!this.documents.has(id)) this.documents.set(id, new Set());
            this.documents.get(id)!.add(doc);
          }
        }
        if (!result.isError && tool === 'krita_document') {
          const value = JSON.parse(
            result.content.find((c: Wire) => c.type === 'text')?.text ?? '{}',
          );
          if (args.action === 'close') {
            this.documents.get(id)?.delete(args.document_id);
            const previous = this.previousKritaDocument.get(id);
            if (!this.documents.get(id)?.size && previous) {
              const state = await rpc.request(
                'tools/call',
                { name: 'krita_state', arguments: {} },
                30000,
              );
              const current = JSON.parse(
                state.content.find((c: Wire) => c.type === 'text')?.text ?? '{}',
              );
              if (!current.document_id || current.document_id === args.document_id)
                await rpc.request(
                  'tools/call',
                  {
                    name: 'krita_document',
                    arguments: { action: 'activate', document_id: previous },
                  },
                  30000,
                );
              this.previousKritaDocument.delete(id);
            }
          }
          return this.wrap({
            ...value,
            documents: (value.documents ?? []).filter((d: Wire) =>
              this.documents.get(id)?.has(d.document_id),
            ),
          });
        }
        if (!result.isError && tool === 'krita_state') {
          const value = JSON.parse(
            result.content.find((c: Wire) => c.type === 'text')?.text ?? '{}',
          );
          if (!this.documents.get(id)?.has(value.document_id))
            return this.wrap({
              runtime_compatibility: value.runtime_compatibility,
              document_id: null,
              notice:
                'Existing user artwork is preserved. Create a new document for this chat before previewing or editing.',
            });
        }
        return result;
      } catch (e) {
        this.krita = undefined;
        rpc.close();
        throw new Error(
          'Krita outcome is unknown; do not repeat a mutation. Reconnect and inspect state: ' +
            (e as Error).message,
        );
      }
    };
    const result = this.kritaTail.then(run);
    this.kritaTail = result.catch(() => {});
    return result;
  }
  close() {
    this.closed = true;
    this.cancel();
    this.grants.clear();
    this.krita?.close();
    this.krita = undefined;
    for (const p of this.practices.values()) p.close();
    this.practices.clear();
  }
}
