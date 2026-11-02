import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import {
  officeInput,
  regressionInput,
  verifyJmpEstimates,
  blenderInput,
  shoppingPlan,
  chessPosition,
} from '../electron/application-data';
import { Workstation } from '../electron/workstation';
import { Practice } from '../electron/practice';
test('Office validates typed data and refuses formula-based external execution', () => {
  assert.equal(
    officeInput({ kind: 'word', title: 'Report', text: 'hello', table: [['A'], ['B']] }).operation,
    'word',
  );
  assert.throws(() => officeInput({ kind: 'word', table: [['one'], ['two', 'three']] }));
  for (const formula of [
    '=WEBSERVICE("https://evil.example")',
    "=cmd|' /C calc'!A0",
    '=HYPERLINK("https://evil.example")',
    '=SUM([other.xlsx]Sheet!A1)',
    '=RTD("server",,1)',
  ])
    assert.throws(() =>
      officeInput({
        kind: 'spreadsheet',
        headers: ['value'],
        rows: [[1]],
        formulas: [{ cell: 'A3', formula }],
      }),
    );
  const valid = officeInput({
    kind: 'spreadsheet',
    headers: ['Cost'],
    rows: [[12], [28]],
    formulas: [{ cell: 'A4', formula: '=SUM(A2:A3)' }],
  });
  assert.equal(valid.formulas.length, 1);
});
test('scientific inputs use a centered independent OLS check and reject unusable data', () => {
  const result = regressionInput({
    points: [
      [1, 3],
      [2, 5],
      [3, 7],
      [4, 9],
    ],
  });
  assert.equal(result.reference.intercept, 1);
  assert.equal(result.reference.slope, 2);
  assert.equal(result.reference.rSquared, 1);
  const csv = 'Term,Estimate,Std Error\nIntercept,1,0\nx,2,0\n';
  assert.equal(verifyJmpEstimates(csv, result.reference).verifiedAgainstIndependentOLS, true);
  assert.throws(
    () => verifyJmpEstimates(csv.replace('x,2,', 'x,5,'), result.reference),
    /verification failed/,
  );
  assert.throws(
    () => verifyJmpEstimates('Term,Estimate\nx,2', result.reference),
    /verification failed/,
  );
  assert.throws(() =>
    regressionInput({
      points: [
        [1, 2],
        [1, 4],
        [1, 6],
      ],
    }),
  );
  assert.throws(() =>
    regressionInput({
      points: [
        [1, 2],
        [2, NaN],
        [3, 4],
      ],
    }),
  );
  assert.throws(() => blenderInput({ objects: [{ kind: 'run_python', code: 'arbitrary' }] }));
  assert.throws(() => blenderInput({ objects: [{ kind: 'cube', color: [2, 0, 0, 1] }] }));
});
test(
  'Krita scopes activation, painting and saves to newly created documents',
  { skip: process.platform !== 'win32' },
  async () => {
    const station = new Workstation('not-used', () => 'not-used');
    const calls: any[] = [];
    let current = 'existing';
    const reply = (value: any) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
    (station as any).connectKrita = async () => ({
      request: async (_method: string, input: any) => {
        calls.push(input);
        if (input.name === 'krita_state') return reply({ document_id: current });
        if (input.name === 'krita_document' && input.arguments.action === 'create') {
          current = 'owned';
          return reply({ affected_document_id: current });
        }
        if (input.name === 'krita_document' && input.arguments.action === 'close') current = '';
        if (input.name === 'krita_document' && input.arguments.action === 'activate')
          current = input.arguments.document_id;
        return reply({ ok: true });
      },
    });
    const invoke = (tool: string, args: any, id = 'one') =>
      station.invoke(id, 'krita_tools', { tool, arguments: args });
    station.grant('one', ['krita']);
    station.grant('other', ['krita']);
    try {
      await assert.rejects(
        invoke('krita_document', { action: 'open', path: 'existing.kra' }),
        /creates new/,
      );
      await assert.rejects(
        invoke('krita_document', { action: 'save', path: 'existing.kra' }),
        /new paths/,
      );
      await assert.rejects(
        invoke('krita_document', { action: 'activate', document_id: 'existing' }),
        /scoped/,
      );
      await assert.rejects(invoke('krita_document', { action: 'create', width: 32768 }), /4096/);
      await invoke('krita_document', { action: 'create', width: 256, height: 256 });
      await assert.rejects(invoke('krita_draw', { document_id: 'owned' }, 'other'), /scoped/);
      await assert.rejects(
        invoke('krita_save_export', { document_id: 'owned', overwrite: true }),
        /overwrite/,
      );
      await invoke('krita_draw', { shape: 'rectangle', document_id: 'owned' });
      await invoke('krita_document', {
        action: 'close',
        document_id: 'owned',
        discard_changes: true,
      });
      assert.equal(current, 'existing');
      assert.deepEqual(station.catalog('one').kritaDocuments, []);
      assert.equal(calls.filter((c) => c.name === 'krita_draw').length, 1);
      assert.equal(calls.filter((c) => c.name === 'krita_save_export').length, 0);
    } finally {
      station.close();
    }
  },
);
test('shopping totals use integer cents, require final costs for a budget pass and reject mixed currency', () => {
  const result = shoppingPlan({
    items: [{ name: 'Pen', price: 24.5, quantity: 2 }],
    currency: 'USD',
    shipping: 4.25,
    tax: 2.45,
    budget: 60,
  });
  assert.equal(result.total, 55.7);
  assert.equal(result.withinBudget, true);
  const missing = shoppingPlan({ items: [{ name: 'Pen', price: 24.5 }], budget: 30 });
  assert.equal(missing.withinBudget, null);
  assert.equal(missing.missingCosts, true);
  assert.equal(
    shoppingPlan({ items: [{ name: 'x', price: 0.1, quantity: 3 }], shipping: 0, tax: 0 }).total,
    0.3,
  );
  assert.throws(() =>
    shoppingPlan({ currency: 'USD', items: [{ name: 'x', price: 1, currency: 'EUR' }] }),
  );
  assert.throws(() => shoppingPlan({ items: [{ name: 'x', price: -1 }] }));
});
test('chess validates real moves, rejects pass/illegal moves and records mate and PGN', () => {
  assert.throws(() => chessPosition({ moves: ['e2e5'] }));
  assert.throws(() => chessPosition({ moves: ['--'] }));
  const result = chessPosition({ moves: ['f3', 'e5', 'g4', 'Qh4#'] });
  assert.equal(result.checkmate, true);
  assert.equal(result.legalMoves.length, 0);
  assert.ok(result.pgn.includes('0-1'));
  assert.equal(chessPosition({ moves: ['e2e4', 'e7e5'] }).turn, 'w');
});
test('application grants are per chat, fail before spawning, and exports cannot escape the workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wb-apps-')),
    outside = await mkdtemp(join(tmpdir(), 'wb-apps-outside-'));
  const station = new Workstation('not-used', () => root);
  try {
    await assert.rejects(station.invoke('chat', 'office_create', { kind: 'word' }), /Enable/);
    assert.equal(station.catalog('chat').audit.at(-1).status, 'failed');
    station.grant('other', ['office']);
    await assert.rejects(station.invoke('chat', 'office_create', { kind: 'word' }), /Enable/);
    assert.throws(() => station.grant('chat', ['arbitrary']));
    const result = await station.invoke('chat', 'chess_position', { moves: ['e4'], export: true });
    const data = JSON.parse(result.content[0].text);
    assert.ok((await readFile(data.path, 'utf8')).includes('e4'));
    await rm(join(root, 'workbench-output'), { recursive: true, force: true });
    await symlink(outside, join(root, 'workbench-output'), 'junction');
    await assert.rejects(station.invoke('chat', 'chess_position', { export: true }), /leaves/);
  } finally {
    station.close();
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
test('practice storefront/chess stay local, enforce mutation authorization and validate game moves', async () => {
  const practice = new Practice();
  await practice.start();
  try {
    const page = await (await fetch(practice.url)).text();
    assert.ok(page.includes('no purchases'));
    assert.ok(page.includes('Blue fountain pen'));
    const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(practice.url, { headers: { Host: 'foreign.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(foreignHostStatus, 403);
    assert.equal((await fetch(practice.url + '/act', { method: 'POST', body: '{}' })).status, 403);
    const token = /Bearer ([a-f0-9]{48})/.exec(page)![1];
    const act = (body: any, origin = practice.url) =>
      fetch(practice.url + '/act', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, Origin: origin },
        body: JSON.stringify(body),
      });
    assert.equal((await act({ action: 'add' }, 'https://foreign.example')).status, 403);
    await act({ action: 'add' });
    await act({ action: 'add' });
    assert.equal(practice.state().total, 55.7);
    assert.equal((await act({ action: 'move', move: { from: 'd8', to: 'd3' } })).status, 400);
    assert.equal((await act({ action: 'move', move: { from: 'd8', to: 'h4' } })).status, 200);
    assert.equal(practice.state().checkmate, true);
    assert.equal((await act({ action: 'purchase' })).status, 400);
  } finally {
    practice.close();
  }
});
