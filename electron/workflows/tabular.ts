import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { extname } from 'node:path';
import { workspaceFile } from './io';
export function csvRows(source: string): string[][] {
  if (source.length > 4 * 1024 * 1024 || source.includes('\0'))
    throw new Error('CSV exceeds the text limit.');
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted) {
        quoted = false;
        if (source[i + 1] && !/[\r\n,]/.test(source[i + 1]))
          throw new Error('Invalid CSV quoting.');
      } else {
        if (cell) throw new Error('Invalid CSV quoting.');
        quoted = true;
      }
    } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(cell);
      cell = '';
      if (c !== ',') {
        if (c === '\r' && source[i + 1] === '\n') i++;
        rows.push(row);
        row = [];
      }
    } else cell += c;
    if (rows.length > 5001 || row.length > 100 || cell.length > 100000)
      throw new Error('CSV exceeds row/column/cell limits.');
  }
  if (quoted) throw new Error('Unterminated CSV quote.');
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
export const csvEncode = (rows: unknown[][]) =>
  rows
    .map((row) => row.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(','))
    .join('\r\n') + '\r\n';
export async function readTable(root: string, path: string, sheet = 1) {
  const file = await workspaceFile(root, path, 8 * 1024 * 1024);
  if (extname(path).toLowerCase() === '.csv')
    return {
      rows: csvRows(file.bytes.toString('utf8').replace(/^\uFEFF/, '')),
      source: file.path,
      sha256: file.sha256,
    };
  if (
    extname(path).toLowerCase() !== '.xlsx' ||
    !Number.isInteger(sheet) ||
    sheet < 1 ||
    sheet > 20
  )
    throw new Error('Choose CSV or XLSX and sheet number 1..20.');
  let total = 0;
  const entries = unzipSync(file.bytes, {
    filter: (f) => {
      if (!/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(f.name)) return false;
      total += f.originalSize;
      if (total > 16 * 1024 * 1024) throw new Error('Expanded spreadsheet is too large.');
      return true;
    },
  });
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    parseTagValue: false,
    removeNSPrefix: true,
  });
  const parse = (name: string) => {
    const xml = strFromU8(entries[name] ?? new Uint8Array());
    if (!xml || /<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new Error('Missing or unsupported spreadsheet XML.');
    return parser.parse(xml);
  };
  const array = (v: any): any[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  const string = (v: any): string =>
    typeof v === 'string'
      ? v
      : typeof v === 'number'
        ? String(v)
        : v && typeof v === 'object'
          ? Object.entries(v)
              .filter(([k]) => !k.startsWith('@'))
              .map(([, v]) => array(v).map(string).join(''))
              .join('')
          : '';
  const shared = entries['xl/sharedStrings.xml']
    ? array(parse('xl/sharedStrings.xml').sst?.si).map(string)
    : [];
  const native = array(parse(`xl/worksheets/sheet${sheet}.xml`).worksheet?.sheetData?.row);
  if (native.length > 5001) throw new Error('At most 5,001 spreadsheet rows are supported.');
  const rows = native.map((row) => {
    const cells: string[] = [];
    for (const c of array(row.c)) {
      if (c.f !== undefined)
        throw new Error(
          'Export formula cells to values before scientific import; cached formula results may be stale.',
        );
      const ref = String(c['@r'] ?? '').match(/^([A-Z]{1,2})\d+$/);
      if (!ref) throw new Error('Invalid spreadsheet cell reference.');
      const column = [...ref[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
      if (column >= 100) throw new Error('At most 100 columns are supported.');
      cells[column] =
        c['@t'] === 's'
          ? (shared[Number(c.v)] ?? '')
          : c['@t'] === 'inlineStr'
            ? string(c.is)
            : String(c.v ?? '');
    }
    return Array.from({ length: cells.length }, (_, i) => cells[i] ?? '');
  });
  return { rows, source: file.path, sha256: file.sha256 };
}
export function numericPairs(rows: string[][], x: string, y: string) {
  if (rows.length < 4) throw new Error('Include headers and at least three rows.');
  const ix = rows[0].indexOf(x),
    iy = rows[0].indexOf(y);
  if (
    ix < 0 ||
    iy < 0 ||
    ix === iy ||
    rows[0].filter((c) => c === x).length !== 1 ||
    rows[0].filter((c) => c === y).length !== 1
  )
    throw new Error('Select distinct, unambiguous x/y column headers.');
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim()))
    .map((row, i) =>
      [ix, iy].map((column) => {
        const cell = row[column]?.trim();
        if (!cell || !/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(cell))
          throw new Error(
            `Non-numeric/missing value in source row ${i + 2}; no rows are silently dropped.`,
          );
        const value = Number(cell);
        if (!Number.isFinite(value) || Math.abs(value) >= 1e12)
          throw new Error('Numeric import exceeds finite bounds.');
        return value;
      }),
    );
}
