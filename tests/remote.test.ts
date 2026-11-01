import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { Store } from '../electron/store';
import { RemoteAccess } from '../electron/remote';
test('remote HTTP enforces pairing, scope, origin, read-only mode, idempotency and revocation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wb-remote-')),
    store = new Store(join(root, 'state.json'));
  const p = store.openProject(root, 'Shared'),
    q = store.openProject(tmpdir(), 'Private');
  const a = store.create(p.id, root),
    b = store.create(q.id, tmpdir());
  a.entries.push({ id: 'answer', type: 'assistant', text: '<script>secret()</script>' });
  store.flush();
  let calls = 0;
  const remote = new RemoteAccess(
    store,
    async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return { id: 'run' };
    },
    () => {},
  );
  try {
    let paired = await remote.start({ projectIds: [p.id], control: false });
    const headers = { Authorization: `Bearer ${paired.token}` };
    assert.equal((await fetch(paired.localUrl + '/v1/sessions')).status, 401);
    const sessions = await fetch(paired.localUrl + '/v1/sessions', { headers }).then((r) =>
      r.json(),
    );
    assert.deepEqual(
      sessions.sessions.map((s: any) => s.id),
      [a.id],
    );
    const html = await fetch(paired.localUrl!).then((r) => r.text());
    assert.ok(html.includes('textContent'));
    assert.ok(!html.includes(paired.token));
    assert.equal((await fetch(paired.localUrl + '/v1/sessions/' + b.id, { headers })).status, 400);
    assert.equal(
      (
        await fetch(paired.localUrl + '/v1/sessions', {
          headers: { ...headers, Origin: 'https://evil.invalid' },
        })
      ).status,
      403,
    );
    const badHost = await new Promise<number>((resolve) => {
      const req = request(
        paired.localUrl + '/v1/sessions',
        { headers: { ...headers, Host: 'evil.invalid' } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.end();
    });
    assert.equal(badHost, 403);
    const post = {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'request-1234567890',
      },
      body: JSON.stringify({ text: 'hello' }),
    };
    assert.equal((await fetch(paired.localUrl + `/v1/sessions/${a.id}/turns`, post)).status, 403);
    remote.stop();
    paired = await remote.start({ projectIds: [p.id], control: true });
    const endpoint = paired.localUrl + `/v1/sessions/${a.id}/turns`;
    post.headers.Authorization = `Bearer ${paired.token}`;
    const results = await Promise.all([fetch(endpoint, post), fetch(endpoint, post)]);
    assert.ok(results.every((r) => [200, 202].includes(r.status)));
    assert.equal(calls, 1);
    assert.equal(
      (await fetch(endpoint, { ...post, body: JSON.stringify({ text: 'different' }) })).status,
      409,
    );
    assert.equal(
      (
        await fetch(endpoint, {
          ...post,
          headers: { ...post.headers, Authorization: headers.Authorization },
        })
      ).status,
      401,
    );
    assert.equal(
      (await fetch(paired.localUrl + '/v1/sessions', { headers: post.headers })).status,
      200,
    );
    remote.stop();
    assert.equal(remote.status().running, false);
  } finally {
    remote.stop();
    store.history.db.close();
  }
});
