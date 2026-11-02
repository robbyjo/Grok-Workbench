const { createInterface } = require('node:readline');
const { handler } = require('./protocol.cjs');
const endpoint = new URL(process.env.WB_DESKTOP_PROBE_ENDPOINT || 'http://invalid/');
const token = process.env.WB_DESKTOP_PROBE_TOKEN || '';
if (
  endpoint.protocol !== 'http:' ||
  endpoint.hostname !== '127.0.0.1' ||
  endpoint.pathname !== '/rpc' ||
  !/^[a-f0-9]{64}$/.test(token)
)
  throw new Error('A private local test-window broker is required.');
const respond = handler(async (name, input) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, input }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Test window unavailable.');
  return response.json();
});
let queue = Promise.resolve();
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  queue = queue
    .then(async () => {
      if (Buffer.byteLength(line) > 65536) throw new Error('Oversized request.');
      const reply = await respond(JSON.parse(line));
      if (reply) process.stdout.write(JSON.stringify(reply) + '\n');
    })
    .catch(() => {
      process.exitCode = 1;
      process.stdin.destroy();
    });
});
