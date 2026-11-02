import { test } from 'node:test';
import assert from 'node:assert/strict';
const { validateAction, handler, scoreTrial } = require('../scripts/desktop-probe/protocol.cjs');

test('desktop probe rejects out-of-window, injected, extra and unsupported actions', () => {
  for (const [name, input] of [
    ['click', { x: -1, y: 20 }],
    ['click', { x: 900, y: 0 }],
    ['click', { x: 1.1, y: 2 }],
    ['click', { x: 1, y: 600 }],
    ['click', { x: 1, y: 2, window: 'another app' }],
    ['type', { text: 'x\n' }],
    ['type', { text: 'x'.repeat(129) }],
    ['screenshot', { path: 'C:/private' }],
    ['shell', { command: 'anything' }],
    ['type', null],
  ])
    assert.throws(() => validateAction(name, input));
  assert.deepEqual(validateAction('click', { x: 899, y: 599 }), { x: 899, y: 599 });
});

test('desktop MCP returns images but never exposes an evaluator or arbitrary broker command', async () => {
  const calls: any[] = [];
  const respond = handler(async (name: string, input: any) => {
    calls.push({ name, input });
    return { content: [{ type: 'image', mimeType: 'image/png', data: 'fixture' }] };
  });
  const inventory = await respond({ id: 1, method: 'tools/list' });
  assert.deepEqual(
    inventory.result.tools.map((t: any) => t.name),
    ['screenshot', 'click', 'type'],
  );
  assert.equal(
    (
      await respond({
        id: 2,
        method: 'tools/call',
        params: { name: 'evaluate', arguments: { script: 'read answers' } },
      })
    ).result.isError,
    true,
  );
  assert.equal(calls.length, 0);
  assert.equal(
    (await respond({ id: 3, method: 'tools/call', params: { name: 'screenshot', arguments: {} } }))
      .result.content[0].type,
    'image',
  );
  assert.equal(await respond({ method: 'notifications/initialized' }), undefined);
});

test('desktop score requires actual verified state, observation after typing and a final screenshot', () => {
  const trial = {
    evaluation: { verified: true, shifted: true, status: 'VERIFIED', events: [] },
    actions: [
      { name: 'screenshot' },
      { name: 'click' },
      { name: 'type' },
      { name: 'screenshot' },
      { name: 'click', verified: true },
      { name: 'screenshot', verified: true },
    ],
  };
  assert.equal(scoreTrial(trial).passed, true);
  assert.equal(
    scoreTrial({ ...trial, evaluation: { ...trial.evaluation, verified: false } }).passed,
    false,
  );
  assert.equal(scoreTrial({ ...trial, actions: trial.actions.slice(0, -1) }).passed, false);
  assert.equal(
    scoreTrial({ ...trial, actions: trial.actions.filter((_a: any, i: number) => i !== 3) }).passed,
    false,
  );
  assert.equal(
    scoreTrial({ ...trial, actions: [{ name: 'assistant', text: 'I completed it' }] }).passed,
    false,
  );
});
