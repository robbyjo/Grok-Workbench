import { randomBytes, randomUUID } from 'node:crypto';
import type { Wire } from '../../shared/types';
import { list, save } from './io';
import { localJSON, loopback } from './local-api';
const clean = (v: unknown, limit = 5000) => {
  if (typeof v !== 'string' || v.length > limit || v.includes('\0'))
    throw new Error('Invalid bibliographic text.');
  return v;
};
export function references(value: Wire[]) {
  return list(value, 200).map((v, i) => ({
    ...v,
    id: clean(String(v.id ?? i + 1), 100),
    type: clean(v.type ?? 'article-journal', 100),
    title: clean(v.title),
    author: (v.author ?? []).slice(0, 30).map((a: Wire) => ({
      family: clean(a.family ?? '', 200),
      given: clean(a.given ?? '', 200),
      literal: clean(a.literal ?? '', 300),
    })),
    issued: v.issued,
    DOI: clean(v.DOI ?? '', 500),
    URL: clean(v.URL ?? '', 2000),
    'container-title': clean(v['container-title'] ?? '', 1000),
    tags: (v.tags ?? []).slice(0, 30).map((t: unknown) => clean(t, 100)),
  }));
}
const risTypes: Wire = {
  'article-journal': 'JOUR',
  book: 'BOOK',
  chapter: 'CHAP',
  'paper-conference': 'CONF',
  webpage: 'ELEC',
  report: 'RPRT',
  thesis: 'THES',
  document: 'GEN',
};
export function parseRis(text: string) {
  const items: Wire[] = [];
  let item: Wire | undefined;
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9]{2})  - ?(.*)$/.exec(line);
    if (!m) continue;
    const [, tag, value] = m;
    if (tag === 'TY')
      item = {
        id: String(items.length + 1),
        type: Object.keys(risTypes).find((k) => risTypes[k] === value) ?? 'document',
        title: '',
        author: [],
      };
    if (!item) continue;
    if (['TI', 'T1'].includes(tag)) item.title = value;
    if (tag === 'ID') item.id = value;
    if (tag === 'PB') item.publisher = value;
    if (tag === 'CY') item['publisher-place'] = value;
    if (tag === 'VL') item.volume = value;
    if (tag === 'IS') item.issue = value;
    if (tag === 'SP') item.page = value;
    if (tag === 'AU') {
      const [family, ...given] = value.split(',');
      item.author.push(
        value.endsWith(',,')
          ? { literal: value.slice(0, -2).trim() }
          : { family: family.trim(), given: given.join(',').trim() },
      );
    }
    if (['PY', 'Y1'].includes(tag))
      item.issued = { 'date-parts': [[Number(value.slice(0, 4)) || 0]] };
    if (tag === 'DO') item.DOI = value;
    if (tag === 'UR') item.URL = value;
    if (['JO', 'JF', 'T2'].includes(tag)) item['container-title'] = value;
    if (tag === 'ER') {
      items.push(item);
      item = undefined;
    }
  }
  if (item) throw new Error('RIS record is missing ER.');
  return references(items);
}
export function toRis(items: Wire[]) {
  return (
    items
      .map((i) =>
        [
          'TY  - ' + (risTypes[i.type] ?? 'GEN'),
          `ID  - ${i.id}`,
          `TI  - ${i.title}`,
          ...i.author.map(
            (a: Wire) => `AU  - ${a.literal ? a.literal + ',,' : a.family + ', ' + a.given}`,
          ),
          `PY  - ${i.issued?.['date-parts']?.[0]?.[0] ?? ''}`,
          `JO  - ${i['container-title']}`,
          `PB  - ${i.publisher ?? ''}`,
          `CY  - ${i['publisher-place'] ?? ''}`,
          `VL  - ${i.volume ?? ''}`,
          `IS  - ${i.issue ?? ''}`,
          `SP  - ${i.page ?? ''}`,
          `DO  - ${i.DOI}`,
          `UR  - ${i.URL}`,
          'ER  - ',
        ]
          .map((s) => s.replace(/[\r\n]/g, ' '))
          .join('\r\n'),
      )
      .join('\r\n\r\n') + '\r\n'
  );
}
export function bibliography(items: Wire[]) {
  return items
    .map((i) =>
      `${i.id}. ${i.author.map((a: Wire) => a.literal || [a.family, a.given].filter(Boolean).join(', ')).join('; ') || 'Author not supplied'} (${i.issued?.['date-parts']?.[0]?.[0] || i.issued?.literal || 'n.d.'}). ${i.title}. ${i['container-title'] || ''}${i.volume ? ' ' + i.volume : ''}${i.issue ? ' (' + i.issue + ')' : ''}${i.page ? ', ' + i.page : ''}${i.publisher ? ' ' + i.publisher : ''}${i.DOI ? ' DOI: ' + i.DOI : ''}${i.URL ? ' ' + i.URL : ''}`.trim(),
    )
    .join('\n\n');
}
export async function exportResearch(out: string, items: Wire[], annotations: Wire[] = []) {
  const ids = new Set(items.map((i) => i.id));
  if (ids.size !== items.length) throw new Error('Reference IDs must be unique.');
  if (!Array.isArray(annotations) || annotations.length > 500)
    throw new Error('At most 500 annotations.');
  const notes = annotations
    .map((a) => {
      if (!ids.has(a.item_id) || (typeof a.page !== 'string' && typeof a.page !== 'number'))
        throw new Error('Annotations require a known reference ID and page label.');
      return `[${a.item_id}, p. ${clean(String(a.page), 50)}]\n${clean(a.quote ?? '', 10000)}\n${clean(a.note ?? '', 10000)}`;
    })
    .join('\n\n');
  const bib = bibliography(items);
  return {
    files: [
      await save(out, 'library.csl.json', JSON.stringify(items, null, 2)),
      await save(out, 'library.ris', toRis(items)),
      await save(out, 'bibliography.txt', bib),
      await save(out, 'cited-notes.md', notes || 'No annotations supplied.\n'),
    ],
    result: {
      items: items.length,
      annotations: annotations.length,
      bibliography: bib,
      notice:
        'Bibliography is a plain author/year listing, not a complete CSL style implementation. Imported metadata/quotations require source verification; no missing information is invented.',
    },
  };
}
const key = () => {
  const alphabet = '23456789ABCDEFGHIJKLMNPQRSTUVWXYZ';
  return [...randomBytes(8)].map((n) => alphabet[n % alphabet.length]).join('');
};
export class ZoteroLocal {
  private authorization = new Map<string, { key: string; server: string }>();
  private plans = new Map<string, Wire>();
  constructor(private origin = 'http://127.0.0.1:23119') {
    loopback(origin);
  }
  async read(input: Wire) {
    const path = input.parent_key
      ? `/api/users/0/items/${this.itemKey(input.parent_key)}/children?itemType=annotation&limit=100`
      : '/api/users/0/items?limit=100&q=' + encodeURIComponent(clean(input.query ?? '', 300));
    const { value } = await localJSON(this.origin, path, {
      headers: { 'Zotero-API-Version': '3' },
    });
    if (!Array.isArray(value)) throw new Error('Unexpected Zotero local API response.');
    return value.map((v: Wire) => ({ key: v.key, data: v.data }));
  }
  private itemKey(v: string) {
    if (!/^[A-Z0-9]{8}$/.test(v)) throw new Error('Invalid Zotero item key.');
    return v;
  }
  async authorize(id: string) {
    const { response, value } = await localJSON(this.origin, '/api/local/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Zotero-API-Version': '3' },
      body: JSON.stringify({ appName: 'Grok Workbench' }),
    });
    const server = response.headers.get('Zotero-Server-ID');
    if (!server || typeof value.key !== 'string')
      throw new Error('Zotero did not grant local write access.');
    this.authorization.set(id, { key: value.key, server });
    return { authorized: true, remember: value.remember === true };
  }
  prepare(id: string, title: string, items: Wire[]) {
    if (items.length > 50)
      throw new Error('Review at most 50 new Zotero records per collection write.');
    const plan: Wire = {
      id: randomUUID(),
      threadId: id,
      title: clean(title, 200),
      items: references(items).map((i) => ({ ...i, key: key() })),
      createdAt: new Date().toISOString(),
      collection: key(),
      state: 'review',
      collectionCreated: false,
    };
    this.plans.set(plan.id, plan);
    return this.view(plan);
  }
  status(id: string) {
    return [...this.plans.values()].filter((p) => p.threadId === id).map((p) => this.view(p));
  }
  private view(p: Wire) {
    return {
      id: p.id,
      title: p.title,
      state: p.state,
      items: p.items.map((i: Wire) => ({ title: i.title, id: i.id })),
      collection: p.collection,
      notice:
        'Creates a NEW Workbench collection and NEW records only. Review and authorize in Workbench; Zotero may also prompt for local write access.',
    };
  }
  async apply(id: string, planId: string) {
    const p = this.plans.get(planId);
    if (!p || p.threadId !== id || !['review', 'partial'].includes(p.state))
      throw new Error('Unknown or completed Zotero plan.');
    const authorization = this.authorization.get(id);
    if (!authorization) throw new Error('Use Authorize Zotero in the panel first.');
    const post = async (path: string, body: Wire[]) => {
      try {
        const { value } = await localJSON(this.origin, path, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Zotero-API-Version': '3',
            'Zotero-API-Key': authorization.key,
            'Zotero-Server-ID': authorization.server,
          },
          body: JSON.stringify(body),
        });
        if (Object.keys(value.failed ?? {}).length)
          throw new Error(
            'Zotero rejected one or more records; inspect the newly created collection before retrying.',
          );
        return value;
      } catch (e) {
        this.authorization.delete(id);
        throw e;
      }
    };
    try {
      if (!p.collectionCreated) {
        await post('/api/users/0/collections', [
          { key: p.collection, name: 'Workbench — ' + p.title, parentCollection: false },
        ]);
        p.collectionCreated = true;
      }
      await post(
        '/api/users/0/items',
        p.items.map((i: Wire) => ({
          key: i.key,
          itemType:
            (
              {
                'article-journal': 'journalArticle',
                book: 'book',
                chapter: 'bookSection',
                'paper-conference': 'conferencePaper',
                webpage: 'webpage',
                report: 'report',
                thesis: 'thesis',
              } as Wire
            )[i.type] ?? 'document',
          title: i.title,
          creators: i.author.map((a: Wire) =>
            a.literal
              ? { creatorType: 'author', name: a.literal }
              : {
                  creatorType: 'author',
                  firstName: a.given,
                  lastName: a.family,
                },
          ),
          date: i.issued?.['date-parts']?.[0]?.[0] ? String(i.issued['date-parts'][0][0]) : '',
          ...(i.type === 'article-journal'
            ? { DOI: i.DOI, publicationTitle: i['container-title'] }
            : { extra: i.DOI ? 'DOI: ' + i.DOI : '' }),
          url: i.URL,
          collections: [p.collection],
          tags: i.tags.map((tag: string) => ({ tag })),
        })),
      );
      p.state = 'complete';
      return this.view(p);
    } catch (e) {
      p.state = 'partial';
      throw e;
    }
  }
  revoke(id?: string) {
    if (id) {
      this.authorization.delete(id);
      for (const [key, plan] of this.plans) if (plan.threadId === id) this.plans.delete(key);
    } else {
      this.authorization.clear();
      this.plans.clear();
    }
  }
}
