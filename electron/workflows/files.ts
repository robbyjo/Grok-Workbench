import { mkdir, link, unlink, lstat, readFile, writeFile, rename } from 'node:fs/promises';
import { join, basename, extname, dirname, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { insideFuture } from '../paths';
import { workspaceFile, workspaceDestination, digest, list, outputDirectory } from './io';
import type { Wire } from '../../shared/types';
export class FilePlans {
  private plans = new Map<string, Wire>();
  private reviewing = new Set<string>();
  async preview(threadId: string, root: string, input: Wire) {
    const rows: Wire[] = [];
    let total = 0;
    for (const path of list<string>(input.paths, 200)) {
      const source = await workspaceFile(root, path);
      total += source.bytes.length;
      if (total > 128 * 1024 * 1024) throw new Error('Plan exceeds 128 MiB.');
      let name = basename(source.path);
      if (input.replace) {
        if (
          typeof input.replace.find !== 'string' ||
          !input.replace.find ||
          typeof input.replace.with !== 'string'
        )
          throw new Error('Supply literal find/with strings.');
        name = name.split(input.replace.find).join(input.replace.with);
      }
      name = (input.prefix ?? '') + name;
      if (
        !/^[^<>:"/\\|?*\x00-\x1f]{1,180}$/.test(name) ||
        /[. ]$/.test(name) ||
        /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)
      )
        throw new Error('Invalid destination filename.');
      const folder = input.group_by_extension
        ? extname(name).slice(1).toLowerCase() || 'no-extension'
        : '';
      const target = await workspaceDestination(
        root,
        join(input.directory ?? 'organized', folder, name),
      );
      if (source.path.toLowerCase() === target.toLowerCase())
        throw new Error('A file already has its target name.');
      rows.push({
        source: source.path,
        target,
        sha256: source.sha256,
        size: source.size,
        mtime: source.mtime,
        ino: source.ino,
        moved: false,
      });
    }
    if (
      new Set(rows.map((r) => r.source.toLowerCase())).size !== rows.length ||
      new Set(rows.map((r) => r.target.toLowerCase())).size !== rows.length
    )
      throw new Error('Duplicate source or colliding destination.');
    const directory = await outputDirectory(root),
      plan: Wire = {
        id: randomUUID(),
        threadId,
        root: await import('node:fs/promises').then((fs) => fs.realpath(root)),
        directory,
        state: 'preview',
        rows,
        createdAt: new Date().toISOString(),
      };
    plan.hash = digest(JSON.stringify(rows));
    await this.persist(plan);
    this.plans.set(plan.id, plan);
    return this.view(plan);
  }
  list(id: string) {
    return [...this.plans.values()].filter((p) => p.threadId === id).map((p) => this.view(p));
  }
  private view(p: Wire) {
    return {
      id: p.id,
      hash: p.hash,
      state: p.state,
      rows: p.rows,
      duplicates: p.rows
        .filter((r: Wire, i: number) => p.rows.findIndex((v: Wire) => v.sha256 === r.sha256) !== i)
        .map((r: Wire) => r.source),
      journal: join(p.directory, 'file-plan.json'),
      notice:
        'Duplicates are reported, never deleted. Apply/undo requires the review button in Workbench.',
    };
  }
  private async persist(p: Wire) {
    const path = join(p.directory, 'file-plan.json'),
      temp = path + '.tmp';
    await writeFile(temp, JSON.stringify(p, null, 2));
    await rename(temp, path);
  }
  async restore(id: string, root: string, path: string) {
    const f = await workspaceFile(root, path, 1024 * 1024);
    root = await import('node:fs/promises').then((fs) => fs.realpath(root));
    const p = JSON.parse(f.bytes.toString());
    if (
      !p ||
      !Array.isArray(p.rows) ||
      !p.rows.length ||
      p.rows.length > 200 ||
      typeof p.id !== 'string' ||
      p.rows.some(
        (r: Wire) =>
          typeof r.source !== 'string' ||
          typeof r.target !== 'string' ||
          typeof r.moved !== 'boolean',
      )
    )
      throw new Error('Invalid file-plan journal.');
    if (
      p.root !== (await import('node:fs/promises').then((fs) => fs.realpath(root))) ||
      p.hash !==
        digest(JSON.stringify(p.rows.map(({ moved, ...r }: Wire) => ({ ...r, moved: false }))))
    )
      throw new Error('Journal identity/hash mismatch.');
    for (const row of p.rows) {
      await insideFuture(root, relative(root, row.source));
      await insideFuture(root, relative(root, row.target));
    }
    if (
      !['applied', 'partial', 'preview', 'undone'].includes(p.state) ||
      p.directory !== dirname(f.path)
    )
      throw new Error('Unsupported file-plan journal.');
    p.threadId = id;
    this.plans.set(p.id, p);
    return this.view(p);
  }
  async review(id: string, planId: string, hash: string, undo = false, guard = () => true) {
    if (this.reviewing.has(planId)) throw new Error('This file plan is already being applied.');
    this.reviewing.add(planId);
    try {
      return await this.performReview(id, planId, hash, undo, guard);
    } finally {
      this.reviewing.delete(planId);
    }
  }
  private async performReview(
    id: string,
    planId: string,
    hash: string,
    undo = false,
    guard = () => true,
  ) {
    if (!guard()) throw new Error('File-plan permission changed.');
    const p = this.plans.get(planId);
    if (!p || p.threadId !== id || p.hash !== hash)
      throw new Error('Plan changed or belongs to another chat.');
    if (undo ? !['applied', 'partial'].includes(p.state) : p.state !== 'preview')
      throw new Error('Plan is not ready for this action.');
    const rows = (
      undo
        ? p.rows
            .filter((r: Wire) => r.moved)
            .slice()
            .reverse()
        : p.rows
    ) as Wire[];
    for (const row of rows) {
      const from = undo ? row.target : row.source,
        to = undo ? row.source : row.target;
      const f = await workspaceFile(p.root, from);
      if (f.sha256 !== row.sha256 || (!undo && (f.ino !== row.ino || f.mtime !== row.mtime)))
        throw new Error('Source changed since preview; create a new plan.');
      const canonical = await workspaceDestination(p.root, relative(p.root, to));
      if (canonical.toLowerCase() !== resolve(to).toLowerCase())
        throw new Error('Destination changed to a linked path.');
      try {
        await lstat(to);
        throw new Error('Destination exists; nothing will be overwritten.');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    try {
      for (const row of rows) {
        if (!guard())
          throw new Error('File moves stopped; review the partial journal before continuing.');
        const from = undo ? row.target : row.source,
          to = undo ? row.source : row.target;
        await mkdir(dirname(to), { recursive: true });
        await link(from, to);
        try {
          await unlink(from);
        } catch (e) {
          await unlink(to);
          throw e;
        }
        row.moved = !undo;
        p.state = 'partial';
        await this.persist(p);
      }
      p.state = undo ? 'undone' : 'applied';
      await this.persist(p);
      return this.view(p);
    } catch (e) {
      p.state = 'partial';
      await this.persist(p);
      throw e;
    }
  }
}
