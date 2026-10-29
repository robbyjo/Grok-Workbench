import type { Entry, Wire } from './types';
export interface TurnEdit {
  path: string;
  before: string | null;
  after: string;
  toolCallId: string;
}
export function turnEdits(entries: Entry[]) {
  const edits: TurnEdit[] = [];
  let truncated = false,
    bytes = 0;
  for (const entry of entries) {
    if (entry.type !== 'tool' || entry.data?.status !== 'completed') continue;
    for (const content of entry.data.content ?? []) {
      const d: Wire = content.type === 'diff' ? content : content.diff;
      if (
        !d ||
        typeof d.path !== 'string' ||
        typeof d.newText !== 'string' ||
        (d.oldText !== undefined && d.oldText !== null && typeof d.oldText !== 'string')
      )
        continue;
      bytes += d.path.length + d.newText.length + (d.oldText?.length ?? 0);
      if (edits.length >= 100 || bytes > 1024 * 1024) {
        truncated = true;
        break;
      }
      const last = [...edits].reverse().find((e) => e.path === d.path);
      // Only coalesce exact adjacent versions; an external writer breaks the chain.
      if (last && last.after === d.oldText) last.after = d.newText;
      else
        edits.push({
          path: d.path,
          before: d.oldText ?? null,
          after: d.newText,
          toolCallId: entry.data.toolCallId,
        });
    }
    if (truncated) break;
  }
  return { edits: edits.filter((e) => e.before !== e.after), truncated };
}
