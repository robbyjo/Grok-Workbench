import { randomUUID } from 'node:crypto';
import type { DesktopEvent, Wire } from '../../shared/types';
export class WorkflowRenderer {
  private pending = new Map<
    string,
    { resolve: (value: Wire) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  constructor(private emit: (e: DesktopEvent) => void) {}
  request(kind: 'pdf' | 'svg' | 'audio', data: string, options: Wire = {}): Promise<Wire> {
    if (this.pending.size) throw new Error('Another desktop document is being rendered.');
    return new Promise((resolve, reject) => {
      const id = randomUUID(),
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('Document rendering timed out.'));
        }, 40000);
      this.pending.set(id, { resolve, reject, timer });
      this.emit({ type: 'desktop-render', id, kind, data, options });
    });
  }
  result(input: Wire) {
    const p = this.pending.get(input.requestId);
    if (!p) throw new Error('Rendering request expired.');
    this.pending.delete(input.requestId);
    clearTimeout(p.timer);
    if (input.error) p.reject(new Error(String(input.error).slice(0, 500)));
    else if (
      !input.value ||
      typeof input.value !== 'object' ||
      JSON.stringify(input.value).length > 24 * 1024 * 1024
    )
      p.reject(new Error('Rendering result exceeds limits.'));
    else p.resolve(input.value);
  }
  close() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Rendering stopped.'));
    }
    this.pending.clear();
  }
}
