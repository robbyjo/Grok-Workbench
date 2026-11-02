export function loopback(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Local integrations require an http://127.0.0.1:PORT origin.');
  return url.origin;
}
export async function localRequest(
  origin: string,
  path: string,
  init: RequestInit = {},
  max = 4 * 1024 * 1024,
) {
  const response = await fetch(loopback(origin) + path, {
    ...init,
    redirect: 'error',
    signal: init.signal ?? AbortSignal.timeout(15000),
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > max) throw new Error('Local service response exceeds limits.');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (!response.ok)
    throw new Error(
      `Local service request failed (${response.status}): ${bytes.toString('utf8').slice(0, 250)}`,
    );
  return { response, bytes };
}
export async function localJSON(origin: string, path: string, init: RequestInit = {}) {
  const { response, bytes } = await localRequest(origin, path, init);
  return { response, value: JSON.parse(bytes.toString('utf8')) };
}
