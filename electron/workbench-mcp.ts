// Minimal STDIO MCP transport. Only the private, per-chat loopback broker owns capabilities.
import { createInterface } from 'node:readline';
const endpoint = new URL(process.env.GROK_WORKBENCH_ENDPOINT ?? 'http://invalid/');
const token = process.env.GROK_WORKBENCH_TOKEN ?? '';
if (
  endpoint.protocol !== 'http:' ||
  endpoint.hostname !== '127.0.0.1' ||
  endpoint.pathname !== '/rpc' ||
  !/^[a-f0-9]{64}$/.test(token)
)
  throw new Error('Private Workbench broker required.');
async function call(body: object) {
  const result = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35000),
  });
  if (!result.ok) throw new Error('Workbench tool broker unavailable.');
  return result.json();
}
let queue = Promise.resolve();
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  queue = queue
    .then(async () => {
      if (Buffer.byteLength(line) > 550000) throw new Error('Oversized MCP request.');
      const message = JSON.parse(line);
      if (message.id === undefined) return;
      let result: any, error: any;
      try {
        switch (message.method) {
          case 'initialize':
            result = {
              protocolVersion: message.params?.protocolVersion ?? '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'grok-workbench-tools', version: '1.0.0' },
            };
            break;
          case 'ping':
            result = {};
            break;
          case 'tools/list':
            result = await call({ operation: 'list' });
            break;
          case 'tools/call':
            result = await call({
              name: message.params?.name,
              input: message.params?.arguments ?? {},
            });
            break;
          default:
            error = { code: -32601, message: 'Unsupported method.' };
        }
      } catch (e) {
        result = { isError: true, content: [{ type: 'text', text: (e as Error).message }] };
      }
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id: message.id, ...(error ? { error } : { result }) }) +
          '\n',
      );
    })
    .catch(() => {
      process.exitCode = 1;
      process.stdin.destroy();
    });
});
