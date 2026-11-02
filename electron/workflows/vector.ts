import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { Wire } from '../../shared/types';
import { bounded, list } from './io';
const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const color = (v: string) => {
  if (!/^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|none|transparent)$/i.test(v))
    throw new Error('Use hexadecimal colors, none or transparent.');
  return v;
};
export function createSvg(input: Wire) {
  const width = bounded(input.width ?? 800, 32, 4096),
    height = bounded(input.height ?? 600, 32, 4096);
  const content = list<Wire>(input.shapes, 200)
    .map((s, i) => {
      if (
        !['rect', 'circle', 'ellipse', 'line', 'text', 'polyline', 'polygon', 'path'].includes(
          s.kind,
        )
      )
        throw new Error(
          'SVG shapes require kind: rect, circle, ellipse, line, text, polyline, polygon or path.',
        );
      const attrs: Wire = {
        id: `shape-${i + 1}`,
        fill: color(s.fill ?? '#4477aa'),
        stroke: color(s.stroke ?? 'none'),
        'stroke-width': bounded(s.stroke_width ?? 1, 0, 100),
      };
      for (const k of [
        'x',
        'y',
        'width',
        'height',
        'cx',
        'cy',
        'r',
        'rx',
        'ry',
        'x1',
        'x2',
        'y1',
        'y2',
      ])
        if (s[k] !== undefined) attrs[k] = bounded(s[k], -10000, 10000);
      if (s.points) {
        if (
          typeof s.points !== 'string' ||
          s.points.length > 20000 ||
          !/^[\d\s,.-]+$/.test(s.points)
        )
          throw new Error('Invalid vector points.');
        attrs.points = s.points;
      }
      if (s.d) {
        if (
          typeof s.d !== 'string' ||
          s.d.length > 20000 ||
          !/^[MmLlHhVvCcSsQqTtAaZz\deE+.,\s-]+$/.test(s.d)
        )
          throw new Error('Invalid vector path.');
        attrs.d = s.d;
      }
      if (s.kind === 'text') {
        attrs['font-size'] = bounded(s.font_size ?? 24, 6, 200);
        attrs['font-family'] = 'sans-serif';
      }
      return `<${s.kind} ${Object.entries(attrs)
        .map(([k, v]) => `${k}="${escape(String(v))}"`)
        .join(
          ' ',
        )}>${s.kind === 'text' ? escape(String(s.text ?? '').slice(0, 10000)) : ''}</${s.kind}>`;
    })
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
}
export function editSvg(source: string, edits: Wire[]) {
  if (
    source.length > 2 * 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY|<\?|<\s*(?:script|foreignObject|image|use|style|a)\b|\bon\w+\s*=|href\s*=|url\s*\(/i.test(
      source,
    )
  )
    throw new Error('SVG scripts, external resources and active content are excluded.');
  const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@',
      parseTagValue: false,
    }),
    tree = parser.parse(source);
  const allowed = new Set([
    'svg',
    'g',
    'rect',
    'circle',
    'ellipse',
    'line',
    'text',
    'tspan',
    'polyline',
    'polygon',
    'path',
    'title',
    'desc',
  ]);
  const nodes: Wire[] = [];
  const walk = (v: Wire) => {
    for (const [k, value] of Object.entries(v)) {
      if (k.startsWith('@') || k === '#text') {
        if (
          k.startsWith('@') &&
          !/^@(id|xmlns|width|height|viewBox|x|y|cx|cy|rx|ry|r|x1|x2|y1|y2|fill|stroke|stroke-width|font-size|font-family|points|d|transform|opacity)$/.test(
            k,
          )
        )
          throw new Error('Unsupported SVG attribute: ' + k);
        continue;
      }
      if (!allowed.has(k)) throw new Error('Unsupported SVG element: ' + k);
      for (const item of Array.isArray(value) ? value : [value])
        if (item && typeof item === 'object') {
          nodes.push(item);
          walk(item);
        }
    }
  };
  walk(tree);
  if (!tree.svg) throw new Error('Missing SVG root.');
  for (const edit of list(edits, 200)) {
    const matches = nodes.filter((n) => n['@id'] === edit.id);
    if (matches.length !== 1) throw new Error('Vector edit ID is missing or ambiguous.');
    const node = matches[0];
    if (edit.fill !== undefined) node['@fill'] = color(edit.fill);
    if (edit.stroke !== undefined) node['@stroke'] = color(edit.stroke);
    if (edit.text !== undefined) {
      if (typeof edit.text !== 'string' || edit.text.length > 10000)
        throw new Error('Invalid vector text.');
      node['#text'] = edit.text;
    }
    if (edit.translate) {
      if (!Array.isArray(edit.translate) || edit.translate.length !== 2)
        throw new Error('Translate requires two numbers.');
      node['@transform'] =
        `translate(${bounded(edit.translate[0], -10000, 10000)} ${bounded(edit.translate[1], -10000, 10000)})`;
    }
  }
  return new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@' }).build(tree);
}
