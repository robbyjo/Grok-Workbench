import { lstat, readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, sep, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inside, insideFuture } from '../paths';
export const digest = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
export async function workspaceDestination(root: string, path: string) {
  const base = await realpath(root),
    target = await insideFuture(base, path),
    rel = relative(base, target);
  if (
    rel
      .split(sep)
      .some(
        (p) =>
          ['.git', '.aws', '.ssh', '.codex', '.agents', 'node_modules'].includes(p.toLowerCase()) ||
          /^\.env(?:\.|$)/i.test(p),
      )
  )
    throw new Error('Private/configuration destinations are excluded.');
  const expected = resolve(base, path);
  if (
    (process.platform === 'win32' ? target.toLowerCase() : target) !==
    (process.platform === 'win32' ? expected.toLowerCase() : expected)
  )
    throw new Error('Linked destinations are excluded.');
  return target;
}
export async function workspaceFile(root: string, path: string, max = 20 * 1024 * 1024) {
  const base = await realpath(root),
    target = await inside(base, path);
  const rel = relative(base, resolve(base, path));
  if (
    rel
      .split(sep)
      .some(
        (p) =>
          ['.git', '.aws', '.ssh', '.codex', '.agents', 'node_modules'].includes(p.toLowerCase()) ||
          /^\.env(?:\.|$)/i.test(p),
      )
  )
    throw new Error('Private/configuration files are excluded.');
  if (target.toLowerCase() !== resolve(base, path).toLowerCase())
    throw new Error('Linked paths are excluded.');
  let current = base;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Linked paths are excluded.');
  }
  const info = await lstat(target);
  if (!info.isFile() || info.nlink !== 1 || info.size > max)
    throw new Error('Choose an ordinary, unlinked file within the size limit.');
  const bytes = await readFile(target);
  if (bytes.length > max) throw new Error('File grew beyond the size limit.');
  return {
    path: target,
    bytes,
    sha256: digest(bytes),
    size: info.size,
    mtime: info.mtimeMs,
    ino: info.ino,
  };
}
export async function outputDirectory(root: string) {
  const parent = await insideFuture(root, 'workbench-output');
  if (parent.toLowerCase() !== resolve(await realpath(root), 'workbench-output').toLowerCase())
    throw new Error('Output folder is linked.');
  await mkdir(parent, { recursive: true });
  const path = join(parent, randomUUID());
  await mkdir(path);
  return path;
}
export async function save(root: string, name: string, bytes: string | Uint8Array) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(name)) throw new Error('Invalid artifact name.');
  const path = join(root, name);
  await writeFile(path, bytes, { flag: 'wx' });
  return { name, path, bytes: typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.length };
}
export function list<T>(value: T[], max = 100) {
  if (!Array.isArray(value) || !value.length || value.length > max)
    throw new Error(`Supply 1..${max} items.`);
  return value;
}
export function bounded(value: unknown, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`Expected number in ${min}..${max}.`);
  return value;
}
