import { parentPort, workerData } from 'node:worker_threads';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
try {
  let total = 0,
    count = 0;
  const files = unzipSync(new Uint8Array(workerData.bytes), {
    filter: (f) => {
      if (++count > 10000) throw new Error('Archive has too many entries.');
      if (
        !/^(word\/document\.xml|xl\/(sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml)|ppt\/slides\/slide\d+\.xml)$/.test(
          f.name,
        )
      )
        return false;
      total += f.originalSize;
      if (f.originalSize > 4 * 1024 * 1024 || total > 16 * 1024 * 1024)
        throw new Error('Expanded document exceeds preview limits.');
      return true;
    },
  });
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    removeNSPrefix: true,
    processEntities: true,
    parseTagValue: false,
    htmlEntities: false,
  });
  const parse = (name: string) => {
    const data = files[name];
    if (!data) throw new Error('Required document content is missing.');
    const xml = strFromU8(data);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new Error('XML entity declarations are not supported.');
    return parser.parse(xml);
  };
  const array = (v: any): any[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  const text = (v: any): string => {
    if (v === undefined) return '';
    if (typeof v !== 'object') return String(v);
    return Object.entries(v)
      .filter(([k]) => !k.startsWith('@'))
      .map(([, item]) => (Array.isArray(item) ? item.map(text).join('') : text(item)))
      .join('');
  };
  const collect = (v: any, key: string): any[] => {
    if (!v || typeof v !== 'object') return [];
    return Object.entries(v).flatMap(([k, item]) =>
      k === key ? array(item) : array(item).flatMap((i) => collect(i, key)),
    );
  };
  const sections: any[] = [];
  let truncated = false;
  if (workerData.extension === '.docx') {
    // Ordered parser preserves paragraph/table reading order; no active content is rendered.
    const xml = strFromU8(files['word/document.xml'] ?? new Uint8Array());
    if (!xml || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsupported Word document.');
    const ordered = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: true,
      removeNSPrefix: true,
      processEntities: true,
      parseTagValue: false,
    }).parse(xml);
    const paragraphs = collect(ordered, 'p')
      .map((p) => collect(p, 't').map(text).join(''))
      .filter(Boolean);
    sections.push({ title: 'Document', paragraphs: paragraphs.slice(0, 2000) });
    truncated = paragraphs.length > 2000;
  } else if (workerData.extension === '.pptx') {
    const names = Object.keys(files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/slide(\d+)/)![1]) - Number(b.match(/slide(\d+)/)![1]));
    if (!names.length) throw new Error('No slides found.');
    names.slice(0, 50).forEach((name, i) =>
      sections.push({
        title: `Slide ${i + 1}`,
        paragraphs: collect(parse(name), 'p')
          .slice(0, 200)
          .map((p) => collect(p, 't').map(text).join('')),
      }),
    );
    truncated = names.length > 50;
  } else {
    const strings = files['xl/sharedStrings.xml']
      ? array(parse('xl/sharedStrings.xml').sst?.si).map(text)
      : [];
    const relationships = array(parse('xl/_rels/workbook.xml.rels').Relationships?.Relationship);
    const sheets = array(parse('xl/workbook.xml').workbook?.sheets?.sheet);
    if (!sheets.length) throw new Error('No worksheets found.');
    for (const sheet of sheets.slice(0, 10)) {
      const rel = relationships.find((r) => r['@Id'] === sheet['@id']);
      const target = String(rel?.['@Target'] ?? '').replace(/^\/?xl\//, '');
      if (!/^worksheets\/sheet\d+\.xml$/.test(target))
        throw new Error('Unsupported worksheet relationship.');
      const rows = array(parse('xl/' + target).worksheet?.sheetData?.row);
      const cells = rows.slice(0, 200).map((row) => {
        const values: string[] = [];
        for (const c of array(row.c)) {
          const letters = /^([A-Z]{1,3})\d+$/.exec(c['@r'] ?? '')?.[1];
          if (!letters) continue;
          const column = [...letters].reduce((n, x) => n * 26 + x.charCodeAt(0) - 64, 0) - 1;
          if (column >= 50) {
            truncated = true;
            continue;
          }
          values[column] = String(
            c['@t'] === 's'
              ? (strings[Number(c.v)] ?? '')
              : c['@t'] === 'inlineStr'
                ? text(c.is)
                : (c.v ?? (c.f ? '[formula: no cached result]' : '')),
          ).slice(0, 2000);
        }
        return Array.from({ length: values.length }, (_, i) => values[i] ?? '');
      });
      truncated ||= rows.length > 200;
      sections.push({
        title: String(sheet['@name'] ?? 'Sheet'),
        rows: cells,
        rowNumbers: rows.slice(0, 200).map((row, i) => String(row['@r'] ?? i + 1)),
      });
    }
    truncated ||= sheets.length > 10;
  }
  // Bound IPC output independently from archive input.
  if (JSON.stringify(sections).length > 2 * 1024 * 1024)
    throw new Error('Extracted content exceeds the 2 MiB preview limit.');
  parentPort?.postMessage({
    kind: 'office',
    sections,
    truncated,
    notice:
      'Content preview; layout, charts, images and macros are omitted. Spreadsheet formulas show stored values without recalculation.',
  });
} catch (e) {
  parentPort?.postMessage({ error: (e as Error).message });
}
