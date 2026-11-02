import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Wire } from '../shared/types';

export class WindowsDesktop {
  private child?: ChildProcessWithoutNullStreams;
  private tail: Promise<unknown> = Promise.resolve();
  private pending?: {
    resolve: (v: any) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  };
  private owner?: string;
  private pendingOwner?: string;
  private title?: string;
  private epoch = 0;
  active() {
    return !!this.owner || !!this.pendingOwner;
  }
  constructor(
    private runtime: string,
    private changed = () => {},
    private excludedPid = process.pid,
  ) {}
  status(id: string) {
    return {
      supported: process.platform === 'win32',
      enabled: this.owner === id,
      enabling: this.pendingOwner === id,
      title: this.owner === id ? this.title : undefined,
    };
  }
  private start() {
    if (process.platform !== 'win32') throw new Error('Desktop control requires Windows.');
    if (this.child) return;
    const path = join(this.runtime, 'desktop-control.exe');
    const manifest = JSON.parse(readFileSync(join(this.runtime, 'desktop-control.json'), 'utf8'));
    if (createHash('sha256').update(readFileSync(path)).digest('hex') !== manifest.sha256)
      throw new Error('Desktop helper integrity check failed. Rebuild/reinstall Workbench.');
    const child = spawn(path, [String(this.excludedPid)], { windowsHide: true, stdio: 'pipe' });
    this.child = child;
    child.stderr.resume();
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (this.child !== child) return;
      const row = this.pending;
      if (!row) return;
      this.pending = undefined;
      clearTimeout(row.timer);
      try {
        const reply = JSON.parse(line);
        reply.error ? row.reject(new Error(reply.error)) : row.resolve(reply.result);
      } catch {
        row.reject(new Error('Invalid desktop helper response.'));
      }
    });
    child.on('error', () => {
      if (this.child === child) this.stop();
    });
    child.on('exit', () => {
      if (this.child === child) this.stop();
    });
  }
  private request(input: Wire, guard = () => true): Promise<any> {
    const run = async () => {
      if (!guard()) throw new Error('Desktop grant was revoked.');
      this.start();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.stop();
          reject(new Error('Desktop operation timed out; control revoked.'));
        }, 15000);
        this.pending = { resolve, reject, timer };
        this.child!.stdin.write(JSON.stringify(input) + '\n');
      });
    };
    const result = this.tail.then(run);
    this.tail = result.catch(() => {});
    return result;
  }
  async windows() {
    return this.request({ op: 'list' });
  }
  async enable(id: string, target: string) {
    this.stop();
    this.pendingOwner = id;
    this.changed();
    const grant = this.epoch;
    try {
      const row = await this.request({ op: 'select', target }, () => this.epoch === grant);
      if (this.epoch !== grant) throw new Error('Desktop grant was revoked.');
      this.owner = id;
      this.pendingOwner = undefined;
      this.title = row.title;
      this.changed();
      return this.status(id);
    } catch (error) {
      if (this.epoch === grant) this.stop();
      throw error;
    }
  }
  async tool(id: string, name: string, input: Wire) {
    if (this.owner !== id)
      throw new Error(
        'Desktop control is off for this chat. Choose a window in Desktop & read aloud.',
      );
    const child = this.child;
    const result = await this.request(
      { ...input, op: name === 'desktop_view' ? 'view' : 'act' },
      () => this.owner === id && this.child === child,
    );
    if (this.owner !== id || this.child !== child) throw new Error('Desktop grant was revoked.');
    if (name === 'desktop_view') {
      const { png, ...view } = result;
      return {
        content: [
          { type: 'text', text: JSON.stringify(view) },
          { type: 'image', mimeType: 'image/png', data: png },
        ],
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
  stop(id?: string) {
    if (id && this.owner !== id && this.pendingOwner !== id) return;
    this.epoch++;
    const child = this.child;
    this.child = undefined;
    child?.kill();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('Desktop control stopped.'));
      this.pending = undefined;
    }
    this.owner = undefined;
    this.pendingOwner = undefined;
    this.title = undefined;
    this.changed();
  }
}
