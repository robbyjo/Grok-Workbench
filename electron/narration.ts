import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import type { Wire } from '../shared/types';
import { previewFile, previewBytes } from './document-preview';
import { generation, mediaType } from './media';
import type { Media } from './media';

export const narrationLimit = 120000;
export function speechChunks(text: string, limit = 4000): string[] {
  if (typeof text !== 'string' || !text.trim())
    throw new Error('There is no readable text. Scanned PDFs need OCR first.');
  if (text.length > narrationLimit)
    throw new Error(
      'Read aloud supports up to 120,000 characters. Select a smaller PDF page range or split the document.',
    );
  if (text.includes('\0')) throw new Error('Binary content cannot be read aloud.');
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length) {
    let end = Math.min(limit, rest.length);
    if (end < rest.length) {
      const part = rest.slice(0, end);
      const boundary = Math.max(
        part.lastIndexOf('\n'),
        part.lastIndexOf('. '),
        part.lastIndexOf('! '),
        part.lastIndexOf('? '),
      );
      const space = part.lastIndexOf(' ');
      if (boundary > limit / 2) end = boundary + 1;
      else if (space > limit / 2) end = space;
      // Never divide a UTF-16 surrogate pair.
      if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
    }
    chunks.push(rest.slice(0, end));
    rest = rest.slice(end).trimStart();
  }
  return chunks;
}
export function pageRange(input: Wire) {
  const start = input.start_page ?? 1,
    end = input.end_page;
  if (
    !Number.isInteger(start) ||
    start < 1 ||
    start > 10000 ||
    (end !== undefined && (!Number.isInteger(end) || end < start || end - start >= 100))
  )
    throw new Error(
      'Select a valid PDF page range of at most 100 pages (page numbers start at 1).',
    );
  return { start, end };
}
export async function narrationText(
  preview: Wire,
  pdf: (data: string, range: Wire) => Promise<string>,
  range: Wire,
): Promise<string> {
  if (preview.truncated)
    throw new Error(
      'Document extraction was truncated. Split the document before reading it aloud.',
    );
  if (preview.kind === 'text' || preview.kind === 'markdown') return preview.text;
  if (preview.kind === 'office')
    return preview.sections.map((s: Wire) => s.paragraphs.join('\n\n')).join('\n\n');
  if (preview.kind === 'pdf') return pdf(preview.data, range);
  throw new Error(
    'Read aloud supports text, PDF and Word DOCX. Convert legacy .doc files to .docx first.',
  );
}
export interface SpeechClient {
  generate(input: Wire): Promise<Uint8Array>;
  close(): void;
  waitForExit(): Promise<void>;
}
export class Narrator {
  private jobs: Wire[] = [];
  private current?: { job: Wire; client?: SpeechClient; resume?: () => void };
  constructor(
    private media: Media,
    private cwd: (id: string) => string,
    private client: (id: string) => SpeechClient,
    private pdf: (data: string, range: Wire) => Promise<string>,
    private changed: () => void,
    private busy: (id: string, active: boolean) => void,
    private beforeStart = async () => {},
  ) {}
  list(id: string) {
    return this.jobs.filter((j) => j.threadId === id).map((j) => ({ ...j, assets: [...j.assets] }));
  }
  isActive(id: string) {
    return this.current?.job.threadId === id;
  }
  async start(id: string, input: Wire) {
    if (this.current)
      throw new Error('A read-aloud job is active. Stop it or wait for completion.');
    const sources = ['text', 'path', 'asset_id'].filter((k) => input[k] !== undefined);
    if (sources.length !== 1) throw new Error('Supply exactly one of text, path or asset_id.');
    const voice = input.voice ?? 'eve';
    if (!['eve', 'ara', 'leo', 'rex', 'sal'].includes(voice))
      throw new Error('Unknown speech voice.');
    const range = pageRange(input);
    this.media.capacity();
    const job: Wire = {
      id: randomUUID(),
      threadId: id,
      title: 'Read aloud',
      voice,
      state: 'preparing',
      assets: [],
      total: 0,
      completed: 0,
      createdAt: new Date().toISOString(),
    };
    const active: NonNullable<Narrator['current']> = { job };
    this.current = active;
    this.jobs.push(job);
    if (this.jobs.length > 30) this.jobs.shift();
    this.busy(id, true);
    this.changed();
    try {
      await this.beforeStart();
      if (this.current !== active) throw new Error('Read aloud stopped.');
      let text: string;
      if (sources[0] === 'text') text = input.text;
      else {
        let preview: Wire, name: string;
        if (sources[0] === 'asset_id') {
          const asset = this.media
            .list()
            .find((a) => a.id === input.asset_id && a.kind === 'attachment');
          if (!asset)
            throw new Error('Choose a stored attachment or a file inside this chat workspace.');
          name = asset.name;
          this.checkExtension(name);
          preview = await previewBytes(this.media.bytes(asset.id), name);
        } else {
          if (typeof input.path !== 'string' || input.path.length > 4096)
            throw new Error('Invalid document path.');
          name = basename(input.path);
          this.checkExtension(name);
          preview = await previewFile(this.cwd(id), input.path);
        }
        job.title = name;
        text = await narrationText(preview, this.pdf, range);
      }
      const chunks = speechChunks(text);
      job.total = chunks.length;
      if (this.current !== active) throw new Error('Read aloud stopped.');
      job.state = job.pauseRequested ? 'paused' : 'generating';
      this.changed();
      void this.run(active, chunks);
      return {
        ...job,
        assets: [...job.assets],
        instruction:
          'Speech is generating in Desktop & read aloud. Audio segments play in order; status/control tools can pause, resume or stop this job.',
      };
    } catch (e) {
      if (this.current === active) {
        job.state = 'failed';
        job.error = (e as Error).message;
        this.current = undefined;
        this.busy(id, false);
        this.changed();
      }
      throw e;
    }
  }
  private checkExtension(name: string) {
    if (!['.txt', '.md', '.text', '.pdf', '.docx'].includes(extname(name).toLowerCase()))
      throw new Error(
        'Read aloud supports .txt, .md, .pdf and Word .docx. Convert legacy .doc to .docx first.',
      );
  }
  private async run(active: NonNullable<Narrator['current']>, chunks: string[]) {
    const { job } = active;
    try {
      active.client = this.client(job.threadId);
      for (const prompt of chunks) {
        if (job.state === 'paused')
          await new Promise<void>((resolve) => {
            active.resume = resolve;
          });
        if (this.current !== active) return;
        this.media.capacity();
        const bytes = Buffer.from(
          await active.client.generate(generation({ kind: 'audio', prompt, voice: job.voice })),
        );
        if (this.current !== active) return;
        const mime = mediaType(bytes, 'speech.mp3');
        if (!['audio/mpeg', 'audio/wav'].includes(mime))
          throw new Error('Speech service returned unsupported audio.');
        const asset = this.media.add(
          bytes,
          `read-aloud-${job.id}-${String(job.completed + 1).padStart(3, '0')}.${mime === 'audio/wav' ? 'wav' : 'mp3'}`,
          'audio',
        );
        job.assets.push(asset);
        job.completed++;
        this.changed();
      }
    } catch (e) {
      if (this.current === active) {
        job.state = 'failed';
        job.error = (e as Error).message;
      }
    } finally {
      active.client?.close();
      await active.client?.waitForExit().catch(() => {});
      if (this.current === active) {
        if (job.state !== 'failed') job.state = 'complete';
        this.current = undefined;
        this.busy(job.threadId, false);
        this.changed();
      }
    }
  }
  control(id: string, jobId: string, action: string) {
    const job = this.jobs.find((j) => j.threadId === id && j.id === jobId);
    if (!job) throw new Error('Read-aloud job is unavailable for this chat.');
    const active = this.current;
    if (!['pause', 'resume', 'stop'].includes(action))
      throw new Error('Choose pause, resume or stop.');
    if (active?.job === job) {
      if (action === 'stop') {
        this.current = undefined;
        job.state = 'stopped';
        active.resume?.();
        active.client?.close();
        this.busy(id, false);
      } else if (action === 'pause') {
        job.pauseRequested = true;
        if (job.state === 'generating') job.state = 'paused';
      } else if (action === 'resume' && job.state === 'preparing') job.pauseRequested = false;
      else if (action === 'resume' && job.state === 'paused') {
        job.pauseRequested = false;
        job.state = 'generating';
        active.resume?.();
        active.resume = undefined;
      }
    }
    job.playback = action;
    job.playbackRevision = (job.playbackRevision ?? 0) + 1;
    this.changed();
    return { ...job, assets: [...job.assets] };
  }
  stop(id?: string) {
    if (this.current && (!id || this.current.job.threadId === id))
      this.control(this.current.job.threadId, this.current.job.id, 'stop');
  }
}
