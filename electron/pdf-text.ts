import { randomUUID } from 'node:crypto';
import type { DesktopEvent, Wire } from '../shared/types';
import { narrationLimit } from './narration';

export class PdfText {
  private pending = new Map<
    string,
    { resolve: (text: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  constructor(private emit: (event: DesktopEvent) => void) {}
  extract(data: string, range: Wire): Promise<string> {
    if (this.pending.size) return Promise.reject(new Error('Another PDF is being extracted.'));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('PDF text extraction timed out.'));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.emit({ type: 'narration-pdf', id, data, start: range.start, end: range.end });
    });
  }
  result(input: Wire) {
    const row = this.pending.get(input.requestId);
    if (!row) throw new Error('PDF request expired.');
    this.pending.delete(input.requestId);
    clearTimeout(row.timer);
    if (typeof input.error === 'string') row.reject(new Error(input.error.slice(0, 500)));
    else if (typeof input.text !== 'string' || input.text.length > narrationLimit)
      row.reject(new Error('PDF text exceeds the read-aloud limit.'));
    else row.resolve(input.text);
  }
  close() {
    for (const row of this.pending.values()) {
      clearTimeout(row.timer);
      row.reject(new Error('PDF extraction stopped.'));
    }
    this.pending.clear();
  }
}
