import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gzipSync, deflateSync, brotliCompressSync, zstdCompressSync } from 'node:zlib';

test(
  'embedded MCP discovers tools through compressed HTTP responses and refuses corrupt gzip',
  { timeout: 100000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'workbench-mcp-compression-')),
      home = join(root, 'grok');
    await mkdir(home);
    const calls: Array<{ codec: string; method: string; accepted: string }> = [];
    const compress = {
      gzip: gzipSync,
      deflate: deflateSync,
      br: brotliCompressSync,
      zstd: zstdCompressSync,
    };
    const server = createServer(async (request, reply) => {
      if (request.method !== 'POST') {
        reply.writeHead(405).end();
        return;
      }
      let raw = '';
      for await (const part of request) raw += part;
      const input = JSON.parse(raw);
      if (input.id === undefined) {
        reply.writeHead(202).end();
        return;
      }
      const codec = request.url!.slice(1);
      calls.push({
        codec,
        method: input.method,
        accepted: String(request.headers['accept-encoding'] ?? ''),
      });
      const result =
        input.method === 'initialize'
          ? {
              protocolVersion: input.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: 'compressed-fixture', version: '1' },
            }
          : input.method === 'tools/list'
            ? {
                tools: [
                  {
                    name: 'compression_echo',
                    description: 'Compressed Unicode: 世界',
                    inputSchema: { type: 'object', properties: {} },
                  },
                ],
              }
            : {};
      const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }));
      const encoded =
        codec === 'corrupt'
          ? Buffer.from('not a gzip stream')
          : compress[codec as keyof typeof compress](body);
      reply.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Encoding': codec === 'corrupt' ? 'gzip' : codec,
        'Content-Length': encoded.length,
      });
      reply.end(encoded);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    try {
      const script = `
      (async()=>{
        const native=require(process.env.STUDIO_TEST_ADDON), results=[];
        native.start(process.cwd(),'test-only-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','oauth');
        for(const codec of ['gzip','deflate','br','zstd','corrupt']) {
          const name='compression-'+codec;
          await native.mcp(JSON.stringify({operation:'add',name,scope:'user',config:{type:'http',url:process.env.STUDIO_TEST_URL+'/'+codec}}));
          results.push({codec,report:JSON.parse(await native.mcp(JSON.stringify({operation:'doctor',name})))});
        }
        console.log('COMPRESSION='+JSON.stringify(results));process.exit(0);
      })().catch(error=>{console.error(error.message);process.exit(1)});
    `;
      const { stdout } = await promisify(execFile)(process.execPath, ['-e', script], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 90000,
        env: {
          ...process.env,
          GROK_HOME: home,
          XAI_API_KEY: '',
          GROK_CODE_XAI_API_KEY: '',
          GROK_DEPLOYMENT_KEY: '',
          STUDIO_TEST_ADDON: resolve('.runtime/studio-engine.node'),
          STUDIO_TEST_URL: address,
        },
      });
      const results = JSON.parse(
        stdout
          .split(/\r?\n/)
          .find((line) => line.startsWith('COMPRESSION='))!
          .slice(12),
      );
      for (const codec of Object.keys(compress)) {
        const row = results.find((r: any) => r.codec === codec);
        assert.equal(row.report.healthy_count, 1, JSON.stringify(row));
        assert.ok(
          row.report.servers[0].checks.some(
            (check: any) => check.label === '1 tools discovered' && check.passed,
          ),
          `${codec} did not decode the tool inventory`,
        );
        assert.ok(
          calls.some((c) => c.codec === codec && c.method === 'tools/list'),
          `${codec} tool discovery did not complete`,
        );
        assert.ok(
          calls
            .filter((c) => c.codec === codec)
            .every((c) => c.accepted.split(/,\s*/).includes(codec)),
          `${codec} was not negotiated`,
        );
      }
      assert.equal(results.find((r: any) => r.codec === 'corrupt').report.failing_count, 1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  },
);
