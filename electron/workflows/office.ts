import { unzipSync, strFromU8 } from 'fflate';
import { writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { workspaceFile, list } from './io';
import { officeInput, text } from '../application-data';
import type { Wire } from '../../shared/types';
export function slidesInput(input: Wire) {
  return {
    operation: 'powerpoint',
    title: text(input.title ?? 'Workbench presentation', 300),
    slides: list<Wire>(input.slides, 30).map((s) => ({
      title: text(s.title ?? '', 300),
      text: text(s.text ?? '', 10000),
    })),
    pdf: input.pdf === true,
  };
}
export function officeEditInput(input: Wire) {
  const source = text(input.path, 4096),
    kind = input.kind;
  if (
    !['word', 'spreadsheet', 'presentation'].includes(kind) ||
    extname(source).toLowerCase() !==
      ({ word: '.docx', spreadsheet: '.xlsx', presentation: '.pptx' } as Wire)[kind]
  )
    throw new Error('Choose a matching DOCX, XLSX or PPTX source.');
  if (kind === 'word') {
    const replacements = input.replacements ?? [],
      comments = input.comments ?? [];
    if (
      !Array.isArray(replacements) ||
      replacements.length > 100 ||
      !Array.isArray(comments) ||
      comments.length > 100
    )
      throw new Error('At most 100 replacements/comments.');
    return {
      operation: 'word',
      source,
      title: '',
      text: '',
      table: [],
      append: text(input.append ?? '', 100000),
      tracked: input.tracked_changes !== false,
      replacements: replacements.map((r) => {
        const find = text(r.find, 4000),
          replace = text(r.replace, 4000);
        if (!find || find.includes('^') || replace.includes('^'))
          throw new Error('Word replacements require nonempty literal text without caret codes.');
        return { find, replace };
      }),
      comments: comments.map((c) => {
        const find = text(c.find, 4000);
        if (!find || find.includes('^'))
          throw new Error('Comments require a nonempty literal anchor without caret codes.');
        return { find, text: text(c.text, 4000) };
      }),
    };
  }
  if (kind === 'presentation') return { ...slidesInput(input), source };
  const data = officeInput({
    kind: 'spreadsheet',
    headers: ['edit'],
    rows: [],
    formulas: input.formulas ?? [],
  });
  const cells = input.cells ?? [];
  if (
    !Array.isArray(cells) ||
    cells.length > 1000 ||
    cells.some(
      (c) =>
        !c ||
        !/^[A-Z]{1,2}[1-9]\d{0,3}$/.test(c.cell) ||
        !(
          c.value === null ||
          (typeof c.value === 'string' && c.value.length <= 2000) ||
          (typeof c.value === 'number' && Number.isFinite(c.value) && Math.abs(c.value) < 1e12)
        ),
    )
  )
    throw new Error('Supply up to 1,000 literal cell edits.');
  return {
    ...data,
    source,
    cells,
    sheet: text(input.sheet ?? '', 100),
    headers: [],
    rows: [],
    chart: input.chart === true,
  };
}
export async function officeSource(root: string, out: string, path: string) {
  const source = await workspaceFile(root, path);
  let total = 0;
  const entries = unzipSync(source.bytes, {
    filter: (f) => {
      total += f.originalSize;
      if (total > 40 * 1024 * 1024) throw new Error('Expanded Office source exceeds 40 MiB.');
      if (
        /(?:vbaProject|embeddings\/|activeX\/|externalLinks\/|connections\.xml|queryTables\/)/i.test(
          f.name,
        )
      )
        throw new Error('Active or external Office content is excluded.');
      return /\.xml$|\.rels$/.test(f.name);
    },
  });
  for (const [name, bytes] of Object.entries(entries)) {
    const xml = strFromU8(bytes);
    if (
      /<!DOCTYPE|<!ENTITY/i.test(xml) ||
      (/\.rels$/.test(name) && /TargetMode\s*=\s*["']External["']/i.test(xml)) ||
      /\b(?:DDEAUTO|INCLUDETEXT|INCLUDEPICTURE)\b/i.test(xml)
    )
      throw new Error('External Office relationships/fields are excluded from automated editing.');
  }
  if (!entries['[Content_Types].xml']) throw new Error('Not an OpenXML document.');
  const copy = join(out, 'source' + extname(path).toLowerCase());
  await writeFile(copy, source.bytes, { flag: 'wx' });
  return { path: copy, sha256: source.sha256 };
}
