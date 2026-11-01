import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../electron/store';
import { Background } from '../electron/background';
import { nextOccurrence, validateSchedule } from '../shared/automation';
const settle = () => new Promise((r) => setImmediate(r));
function fixture() {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'wb-background-')), 'state.json'));
  const project = store.openProject(tmpdir(), 'Fixture'),
    thread = store.create(project.id, tmpdir());
  return { store, project, thread };
}
test('daily schedules handle both DST gaps and repeated hours, and intervals skip missed periods', () => {
  const daily = validateSchedule({ kind: 'daily', time: '01:30', timezone: 'America/New_York' });
  assert.equal(
    nextOccurrence(daily, Date.parse('2026-11-01T04:00:00Z')),
    '2026-11-01T05:30:00.000Z',
  );
  assert.equal(
    nextOccurrence(daily, Date.parse('2026-11-01T05:31:00Z'), '2026-11-01T05:30:00Z'),
    '2026-11-02T06:30:00.000Z',
  );
  assert.equal(
    nextOccurrence(
      { kind: 'daily', time: '02:30', timezone: 'America/New_York' },
      Date.parse('2026-03-08T05:00:00Z'),
    ),
    '2026-03-09T06:30:00.000Z',
  );
  assert.throws(() => validateSchedule({ kind: 'interval', minutes: 1 }));
  assert.throws(() => validateSchedule({ kind: 'daily', time: '29:00', timezone: 'UTC' }));
});
test('scheduled delivery is durable, coalesces due runs, waits for busy chats and does not replay interrupted claims', async () => {
  const { store, project, thread } = fixture();
  let now = Date.parse('2026-10-31T12:00:00Z'),
    calls = 0,
    release!: () => void;
  const background = new Background(
    store,
    async () => {
      calls++;
      await new Promise<void>((r) => (release = r));
    },
    () => {},
    async () => ({}),
    () => {},
    () => now,
  );
  try {
    const schedule = background.save({
      name: 'Test',
      projectId: project.id,
      threadId: thread.id,
      prompt: 'Do a thing',
      schedule: { kind: 'interval', minutes: 5 },
      enabled: true,
    });
    thread.status = 'running';
    now += 3600000;
    await background.tick();
    assert.equal(calls, 0);
    thread.status = 'idle';
    await background.tick();
    await settle();
    assert.equal(calls, 1);
    await background.tick();
    assert.equal(calls, 1);
    assert.equal(background.list().schedules[0].nextAt, new Date(now + 300000).toISOString());
    assert.throws(() => background.edit('schedule', schedule.id, 'stale', 'pause'), /changed/);
    const recovered = new Background(
      store,
      async () => {
        calls++;
      },
      () => {},
      async () => ({}),
      () => {},
      () => now,
    );
    assert.equal(recovered.list().runs[0].status, 'interrupted');
    await recovered.tick();
    assert.equal(calls, 1);
    release();
    await settle();
    assert.equal(background.list().runs[0].status, 'completed');
  } finally {
    background.stop();
    store.history.db.close();
  }
});
test('PR watches establish a quiet baseline, coalesce busy changes, retain snapshots on failure and stop on closure', async () => {
  const { store, thread } = fixture();
  let now = Date.parse('2026-10-31T12:00:00Z'),
    head = 'a',
    fail = false,
    state = 'OPEN';
  const prompts: string[] = [];
  const background = new Background(
    store,
    async (_id, text) => {
      prompts.push(text);
    },
    () => {},
    async () => {
      if (fail) throw new Error('offline');
      return { state, headRefOid: head, comments: [], reviews: [], statusCheckRollup: [] };
    },
    () => {},
    () => now,
  );
  try {
    await background.watch({
      threadId: thread.id,
      repository: 'owner/repo',
      number: 1,
      prompt: 'Inspect updates',
      autoContinue: true,
    });
    await background.tick(true);
    assert.equal(prompts.length, 0);
    thread.status = 'running';
    head = 'b';
    now += 120000;
    await background.tick(true);
    assert.equal(prompts.length, 0);
    head = 'c';
    now += 120000;
    await background.tick(true);
    thread.status = 'idle';
    await background.tick();
    await settle();
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /"head": "c"/);
    assert.match(prompts[0], /untrusted context/);
    await background.tick(true);
    assert.equal(prompts.length, 1);
    fail = true;
    now += 120000;
    await background.tick(true);
    assert.ok(background.list().watches[0].lastError);
    fail = false;
    state = 'MERGED';
    now += 120000;
    await background.tick(true);
    assert.equal(background.list().watches[0].enabled, false);
    assert.equal(prompts.length, 1);
  } finally {
    background.stop();
    store.history.db.close();
  }
});
test('cancelling before model configuration finishes prevents dispatch', async () => {
  const { store, thread } = fixture();
  let calls = 0,
    release!: () => void;
  const background = new Background(
    store,
    async () => {
      calls++;
    },
    () => {},
    async () => ({}),
  );
  background.configure = async () => new Promise<void>((r) => (release = r));
  try {
    const run = await background.run('remote', 'r', 'Remote', thread.id, 'hello');
    background.cancelRun(run.id);
    release();
    await settle();
    assert.equal(calls, 0);
    assert.equal(background.list().runs[0].status, 'interrupted');
  } finally {
    background.stop();
    store.history.db.close();
  }
});
