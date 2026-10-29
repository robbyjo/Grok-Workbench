import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { Store } from '../electron/store';
import { WorkspaceWatch } from '../electron/file-watch';
import { questions, questionReply } from '../electron/questions';
import { turnEdits } from '../shared/turn-review';
import type { Entry, UserQuestion } from '../shared/types';

test('structured answers preserve notes/previews and reject invented, duplicate or multiple single choices', () => {
  const q: UserQuestion = {
    id: 'q',
    threadId: 't',
    mode: 'default',
    questions: questions({
      questions: [
        { question: 'Choose?', options: [{ label: 'A', preview: 'example' }, { label: 'B' }] },
        { question: 'Details?', options: [] },
      ],
    }),
  };
  const input = {
    answers: [
      { selected: ['A'], notes: 'extra' },
      { selected: [], notes: 'typed answer' },
    ],
  };
  const reply = questionReply(q, input);
  assert.equal(reply.annotations['Choose?'].preview, 'example');
  assert.equal(reply.annotations['Details?'].notes, 'typed answer');
  assert.deepEqual(reply.answers['Details?'], ['Other']);
  for (const selected of [['invented'], ['A', 'A'], ['A', 'B']])
    assert.throws(() => questionReply(q, { answers: [{ selected, notes: '' }, input.answers[1]] }));
  assert.throws(() =>
    questions({
      questions: [
        { question: 'x', options: [] },
        { question: 'x', options: [] },
      ],
    }),
  );
  assert.deepEqual(questionReply(q, { cancel: true }), { outcome: 'cancelled' });
});

test('durable unread results reject stale acknowledgement and preserve the first unseen result', () => {
  const folder = mkdtempSync(join(tmpdir(), 'workbench-read-'));
  const file = join(folder, 'state.json');
  const store = new Store(file);
  store.state.projects.push({ id: 'p', name: 'Test', path: folder });
  const thread = store.create('p', folder);
  store.completeResult(thread.id, 'result-1');
  const old = thread.readState!.revision;
  store.completeResult(thread.id, 'result-2');
  assert.throws(() => store.markRead(thread.id, old), /changed/);
  assert.equal(thread.readState!.firstUnread, 'result-1');
  store.flush();
  const reopened = new Store(file);
  assert.equal(reopened.thread(thread.id).readState!.firstUnread, 'result-1');
  reopened.markRead(thread.id, thread.readState!.revision);
  assert.equal(reopened.thread(thread.id).readState!.firstUnread, undefined);
  reopened.markRead(thread.id, reopened.thread(thread.id).readState!.revision, true);
  assert.equal(reopened.thread(thread.id).readState!.firstUnread, 'threadStart');
  store.flush();
  reopened.flush();
  store.history.db.close();
  reopened.history.db.close();
});

test('recursive workspace watch observes real changes and detaches from the previous workspace', async () => {
  const first = mkdtempSync(join(tmpdir(), 'workbench-watch-'));
  const second = mkdtempSync(join(tmpdir(), 'workbench-watch-'));
  const watcher = new WorkspaceWatch();
  let count = 0;
  try {
    watcher.start(first, () => count++, dirname(first));
    writeFileSync(join(first, 'file.txt'), 'first');
    for (let i = 0; i < 30 && !count; i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(count > 0);
    watcher.start(second, () => count++);
    const previous = count;
    writeFileSync(join(first, 'file.txt'), 'previous root');
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(count, previous);
    writeFileSync(join(second, 'file.txt'), 'second');
    for (let i = 0; i < 30 && count === previous; i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(count > previous);
    watcher.start(second, () => count++, second);
    const beforeProfileWrite = count;
    writeFileSync(join(second, 'state.json'), '{}');
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(count, beforeProfileWrite);
  } finally {
    watcher.close();
  }
});

test('turn review combines exact edit chains, isolates external changes, and excludes failures', () => {
  const edit = (before: string | null, after: string, status = 'completed'): Entry => ({
    id: after,
    type: 'tool',
    text: 'Edit',
    turn: 'turn',
    data: {
      toolCallId: after,
      status,
      content: [{ type: 'diff', path: 'file.txt', oldText: before, newText: after }],
    },
  });
  const report = turnEdits([
    edit('original', 'one'),
    edit('one', 'two'),
    edit('external', 'three'),
    edit('three', 'bad', 'failed'),
  ]);
  assert.deepEqual(
    report.edits.map((e) => [e.before, e.after]),
    [
      ['original', 'two'],
      ['external', 'three'],
    ],
  );
  assert.equal(turnEdits([edit('original', 'one'), edit('one', 'original')]).edits.length, 0);
  assert.equal(turnEdits([edit(null, 'new file')]).edits[0].before, null);
  assert.equal(turnEdits([edit('', 'x'.repeat(1024 * 1024 + 1))]).truncated, true);
});
