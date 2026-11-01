import { open, realpath, lstat } from 'node:fs/promises';
import { relative, sep, extname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { inside } from './paths';
import { mediaType } from './media';
export async function previewFile(root: string, path: string) {
  const canonical = await realpath(root),
    target = await inside(canonical, path);
  const parts = relative(canonical, target).split(sep);
  if (
    parts.some(
      (p) =>
        ['.git', '.aws', '.ssh', '.codex', '.agents'].includes(p.toLowerCase()) ||
        /^\.env(?:\.|$)/i.test(p),
    )
  )
    throw new Error('Private configuration cannot be previewed here.');
  const link = await lstat(target);
  if (!link.isFile() || link.isSymbolicLink() || link.nlink !== 1 || link.size > 20 * 1024 * 1024)
    throw new Error('Preview supports unlinked files up to 20 MiB.');
  const file = await open(target, 'r');
  let bytes: Buffer;
  try {
    const info = await file.stat();
    if (
      info.nlink !== 1 ||
      info.ino !== link.ino ||
      info.dev !== link.dev ||
      info.size !== link.size ||
      (await inside(canonical, target)) !== target
    )
      throw new Error('File changed during preview.');
    // Bound the read even if another process grows the file after stat.
    bytes = Buffer.alloc(info.size + 1);
    const result = await file.read(bytes, 0, bytes.length, 0);
    if (result.bytesRead !== info.size) throw new Error('File changed during preview.');
    bytes = bytes.subarray(0, info.size);
  } finally {
    await file.close();
  }
  return previewBytes(bytes, path);
}
export async function previewBytes(bytes: Buffer, name: string): Promise<any> {
  if (bytes.length > 20 * 1024 * 1024) throw new Error('Preview limit is 20 MiB.');
  const mimeType = mediaType(bytes, name);
  if (/^(image|audio|video)\//.test(mimeType) || mimeType === 'application/pdf')
    return {
      kind: mimeType === 'application/pdf' ? 'pdf' : mimeType.split('/')[0],
      mimeType,
      data: bytes.toString('base64'),
    };
  if (/\.(docx|xlsx|pptx)$/i.test(name)) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(join(__dirname, 'document-preview-worker.js'), {
        workerData: { bytes, extension: extname(name).toLowerCase() },
        resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
      });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error('Document preview timed out.'));
      }, 10000);
      worker.once('message', (value) => {
        clearTimeout(timer);
        void worker.terminate();
        value.error ? reject(new Error(value.error)) : resolve(value);
      });
      worker.once('error', () => {
        clearTimeout(timer);
        reject(new Error('Document preview failed within its resource limit.'));
      });
      worker.once('exit', (code) => {
        clearTimeout(timer);
        if (code) reject(new Error('Document preview worker stopped.'));
      });
    });
  }
  if (mimeType === 'text/plain')
    return { kind: /\.md$/i.test(name) ? 'markdown' : 'text', text: bytes.toString('utf8') };
  throw new Error(
    'Preview supports PDF, DOCX, XLSX, PPTX, Markdown, images, audio and video. Legacy Office formats require an external viewer.',
  );
}
