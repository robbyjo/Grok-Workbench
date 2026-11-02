import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { Narrator, speechChunks, narrationText, pageRange } from '../electron/narration';
import { WorkbenchTools } from '../electron/workbench-tools';
import { PdfText } from '../electron/pdf-text';
import { WindowsDesktop } from '../electron/windows-desktop';
import { createHash } from 'node:crypto';

const wait = async (condition: () => boolean) => {
  for (let n = 0; n < 200 && !condition(); n++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(condition());
};
test('Stop during window selection cancels the queued grant before any helper starts', async () => {
  const desktop = new WindowsDesktop('does-not-need-to-exist');
  const pending = desktop.enable('chat', 'unresolved-window');
  assert.equal(desktop.status('chat').enabling, true);
  desktop.stop('chat');
  await assert.rejects(pending, /revoked/);
  assert.equal(desktop.active(), false);
});
test('packaging seals the final helper bytes after resource signing/copying', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wb-helper-seal-'));
  try {
    await mkdir(join(root, 'resources'));
    const bytes = Buffer.from('helper with changed signature bytes');
    await writeFile(join(root, 'resources', 'desktop-control.exe'), bytes);
    await writeFile(
      join(root, 'resources', 'desktop-control.json'),
      JSON.stringify({ sourceSha256: 'preserved-source', sha256: 'before-signing' }),
    );
    await writeFile(join(root, 'resources', 'application-worker.exe'), bytes);
    await writeFile(join(root, 'resources', 'document-worker.ps1'), bytes);
    await writeFile(
      join(root, 'resources', 'document-worker.json'),
      JSON.stringify({ sourceSha256: 'document-source', sha256: 'before-copy' }),
    );
    await writeFile(
      join(root, 'resources', 'application-worker.json'),
      JSON.stringify({ sourceSha256: 'application-source', sha256: 'before-signing' }),
    );
    await require('../scripts/desktop-after-pack.cjs')({
      electronPlatformName: 'win32',
      appOutDir: root,
    });
    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(
      await readFile(join(root, 'resources', 'desktop-control.json'), 'utf8'),
    );
    assert.equal(manifest.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(manifest.sourceSha256, 'preserved-source');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('speech admission enforces quota and a preparation-time pause survives extraction', async () => {
  let calls = 0,
    release: () => void = () => {};
  const locks: boolean[] = [];
  const media: any = {
    capacity() {},
    add: () => ({ id: 'audio', url: 'grok-media://asset/audio' }),
  };
  const client = () => ({
    async generate() {
      calls++;
      return Buffer.from('ID3fixture');
    },
    close() {},
    async waitForExit() {},
  });
  const refused = new Narrator(
    media,
    () => process.cwd(),
    client,
    async () => '',
    () => {},
    (_id, b) => locks.push(b),
    async () => {
      throw new Error('Profile quota');
    },
  );
  await assert.rejects(refused.start('chat', { text: 'test' }), /quota/);
  assert.equal(calls, 0);
  assert.equal(locks.at(-1), false);
  const narrator = new Narrator(
    media,
    () => process.cwd(),
    client,
    async () => '',
    () => {},
    () => {},
    () => new Promise<void>((r) => (release = r)),
  );
  const pending = narrator.start('chat', { text: 'Read only after resume.' });
  const job = narrator.list('chat')[0];
  narrator.control('chat', job.id, 'pause');
  release();
  await pending;
  assert.equal(narrator.list('chat')[0].state, 'paused');
  assert.equal(calls, 0);
  narrator.control('chat', job.id, 'resume');
  await wait(() => narrator.list('chat')[0].state === 'complete');
  assert.equal(calls, 1);
});
test('speech splitting preserves words, Unicode and order and enforces resource limits', () => {
  const text = 'Paragraph 😀. More words!\n\n'.repeat(600);
  const chunks = speechChunks(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 4000));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' ').trim(), text.replace(/\s+/g, ' ').trim());
  assert.throws(() => speechChunks('x'.repeat(120001)), /120,000/);
  assert.throws(() => speechChunks(' \n'), /no readable/);
  assert.throws(() => speechChunks('binary\0'), /Binary/);
  assert.throws(() => pageRange({ start_page: 3, end_page: 2 }), /range/);
  assert.throws(() => pageRange({ end_page: 101 }), /100 pages/);
  assert.deepEqual(pageRange({ start_page: 2, end_page: 3 }), { start: 2, end: 3 });
});
test('documents refuse partial extraction and preserve ordered paragraphs', async () => {
  await assert.rejects(
    narrationText({ truncated: true }, async () => '', {}),
    /truncated/,
  );
  assert.equal(
    await narrationText(
      {
        kind: 'office',
        sections: [{ paragraphs: ['first', 'second'] }, { paragraphs: ['third'] }],
      },
      async () => '',
      {},
    ),
    'first\n\nsecond\n\nthird',
  );
  assert.equal(
    await narrationText({ kind: 'pdf', data: 'pdf' }, async (data, r) => data + r.start, {
      start: 2,
    }),
    'pdf2',
  );
});
test('narration extracts real DOCX/text, rejects private/outside/legacy paths, emits ordered audio and stops isolated speech', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wb-narration-'));
  const assets: any[] = [];
  const prompts: string[] = [];
  const locks: boolean[] = [];
  let release: ((bytes: Uint8Array) => void) | undefined;
  let hold = false,
    closed = 0;
  const media: any = {
    capacity() {},
    list: () => assets,
    bytes: () => Buffer.from('attachment'),
    add(bytes: Buffer, name: string) {
      const a = {
        id: String(assets.length),
        name,
        url: 'grok-media://asset/' + assets.length,
        mimeType: 'audio/mpeg',
      };
      assets.push(a);
      return a;
    },
  };
  const narrator = new Narrator(
    media,
    () => root,
    () => ({
      async generate(input) {
        assert.equal(typeof input.aspect, 'string');
        assert.equal(typeof input.duration, 'number');
        prompts.push(input.prompt);
        if (hold) return new Promise((resolve) => (release = resolve));
        return Buffer.from('ID3fixture');
      },
      close() {
        closed++;
        release?.(Buffer.from('ID3cancelled'));
      },
      async waitForExit() {},
    }),
    async () => '',
    () => {},
    (_id, busy) => locks.push(busy),
  );
  try {
    await writeFile(join(root, 'a.txt'), 'Text fixture.');
    await writeFile(
      join(root, 'a.docx'),
      zipSync({
        'word/document.xml': strToU8(
          '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>First paragraph.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table paragraph.</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
        ),
      }),
    );
    for (const path of ['a.txt', 'a.docx']) {
      const j = await narrator.start('chat', { path });
      await wait(() => narrator.list('chat').find((v) => v.id === j.id)?.state === 'complete');
    }
    assert.deepEqual(prompts, ['Text fixture.', 'First paragraph.\n\nTable paragraph.']);
    await mkdir(join(root, '.ssh'));
    await writeFile(join(root, '.ssh', 'secret.txt'), 'private');
    for (const input of [
      { path: join(root, '..', 'outside.txt') },
      { path: '.ssh/secret.txt' },
      { path: 'old.doc' },
      { text: 'a', path: 'a.txt' },
    ])
      await assert.rejects(narrator.start('chat', input));
    hold = true;
    const j = await narrator.start('chat', { text: 'Long sentence. '.repeat(500) });
    await wait(() => !!release);
    narrator.control('chat', j.id, 'pause');
    release!(Buffer.from('ID3first'));
    await wait(() => narrator.list('chat').find((v) => v.id === j.id)?.completed === 1);
    assert.equal(narrator.list('chat').find((v) => v.id === j.id)?.state, 'paused');
    assert.equal(prompts.length, 3);
    narrator.control('chat', j.id, 'resume');
    await wait(() => prompts.length === 4);
    assert.throws(() => narrator.control('other', j.id, 'stop'), /unavailable/);
    narrator.control('chat', j.id, 'stop');
    await wait(() => closed >= 3);
    assert.equal(narrator.list('chat').find((v) => v.id === j.id)?.state, 'stopped');
    assert.equal(locks.at(-1), false);
    assert.equal(assets.length, 3);
  } finally {
    narrator.stop();
    await rm(root, { recursive: true, force: true });
  }
});
test('PDF result replies require an active nonce and bounded text', async () => {
  const events: any[] = [];
  const pdf = new PdfText((e) => events.push(e));
  const result = pdf.extract('bytes', { start: 1 });
  assert.throws(() => pdf.result({ requestId: 'wrong', text: 'stolen' }), /expired/);
  pdf.result({ requestId: events[0].id, text: 'actual text' });
  assert.equal(await result, 'actual text');
  const oversized = pdf.extract('bytes', {});
  pdf.result({ requestId: events[1].id, text: 'x'.repeat(120001) });
  await assert.rejects(oversized, /limit/);
});
test('per-chat broker authenticates capabilities, rejects origins and unsupported arguments', async () => {
  const calls: any[] = [];
  const broker = new WorkbenchTools(
    {
      tool: async (id: string, name: string, input: any) => {
        calls.push({ id, name, input });
        return { content: [] };
      },
    } as any,
    {
      list: (id: string) => [{ threadId: id }],
      control: (id: string) => ({ threadId: id }),
    } as any,
  );
  await broker.start();
  try {
    const a = broker.servers('a')[0],
      b = broker.servers('b')[0];
    const env = Object.fromEntries(a.env.map((e) => [e.name, e.value]));
    assert.notEqual(a.env.at(-1)?.value, b.env.at(-1)?.value);
    const post = (auth: string, body: any, origin?: string) =>
      fetch(env.GROK_WORKBENCH_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + auth, ...(origin ? { Origin: origin } : {}) },
        body: JSON.stringify(body),
      });
    assert.equal((await post('invalid', {})).status, 403);
    assert.equal(
      (await post(env.GROK_WORKBENCH_TOKEN, {}, 'https://untrusted.example')).status,
      403,
    );
    const response = await (
      await post(env.GROK_WORKBENCH_TOKEN, { name: 'read_aloud_status', input: {} })
    ).json();
    assert.deepEqual(JSON.parse(response.content[0].text), [{ threadId: 'a' }]);
    assert.equal(
      (
        await (
          await post(env.GROK_WORKBENCH_TOKEN, {
            name: 'read_aloud_status',
            input: JSON.parse('{"__proto__":{}}'),
          })
        ).json()
      ).isError,
      true,
    );
    assert.equal(
      (
        await (
          await post(env.GROK_WORKBENCH_TOKEN, { name: 'desktop_act', input: { command: 'shell' } })
        ).json()
      ).isError,
      true,
    );
    assert.equal(calls.length, 0);
  } finally {
    broker.close();
  }
});
