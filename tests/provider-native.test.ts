import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { History } from '../electron/history';
import { Providers, providerModel } from '../electron/providers';
test(
  'embedded engine authenticates a BYOK profile and sends its exact model and key to a local compatible endpoint',
  { timeout: 60000 },
  async () => {
    mkdirSync(resolve('.test-data'), { recursive: true });
    const root = mkdtempSync(resolve('.test-data/provider-native-')),
      home = join(root, 'grok');
    mkdirSync(home);
    const calls: any[] = [];
    const server = createServer(async (req, res) => {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"data":[]}');
        return;
      }
      let raw = '';
      for await (const part of req) raw += part;
      calls.push({ body: JSON.parse(raw), authorization: req.headers.authorization });
      if (req.headers.authorization !== 'Bearer fixture-provider-only') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end('{"error":{"message":"fixture provider key required"}}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const choice of [
        { delta: { role: 'assistant', content: 'PROVIDER_ROUTING_OK' }, finish_reason: null },
        { delta: {}, finish_reason: 'stop' },
      ])
        res.write(
          'data: ' +
            JSON.stringify({
              id: 'fixture',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'fixture-routing',
              choices: [{ index: 0, ...choice }],
            }) +
            '\n\n',
        );
      res.end('data: [DONE]\n\n');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const history = new History(join(root, 'history.sqlite'), 64);
    const providers = new Providers(join(root, 'keys'), history, () => home, {
      isEncryptionAvailable: () => false,
      encryptString: () => {
        throw new Error();
      },
      decryptString: () => {
        throw new Error();
      },
    });
    try {
      const review = await providers.preview({
        name: 'Native fixture',
        baseUrl: `http://127.0.0.1:${(server.address() as any).port}/v1`,
        model: 'fixture-routing',
        contextWindow: 128000,
        backend: 'chat_completions',
      });
      await providers.save({
        token: review.token,
        confirmed: true,
        key: 'fixture-provider-only',
        remember: false,
      });
      const profile = providers.list()[0];
      const script = `
      (async()=>{
        const n=require(process.env.WB_ADDON),port=n.start(process.cwd(),'local-provider-fixture-secret-aaaaaaaaaaaaaaaa','auto');
        let ws; for(let i=0;i<100;i++){const candidate=new WebSocket('ws://127.0.0.1:'+port+'/ws?server-key=local-provider-fixture-secret-aaaaaaaaaaaaaaaa');if(await new Promise(r=>{candidate.onopen=()=>r(true);candidate.onerror=()=>r(false)})){ws=candidate;break;}candidate.close();await new Promise(r=>setTimeout(r,50));}if(!ws)throw Error('socket timeout');
        let sequence=0;const pending=new Map(),output=[];
        ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method&&m.id!==undefined){ws.send(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{outcome:'reject'}}));return;}if(m.method==='session/update')output.push(m.params.update);else if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
        const call=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({jsonrpc:'2.0',id,method,params}));});
        const init=await call('initialize',{protocolVersion:1,clientCapabilities:{},clientInfo:{name:'local-fixture',version:'1'}});
        if(init._meta?.defaultAuthMethodId)await call('authenticate',{methodId:init._meta.defaultAuthMethodId});
        const session=await call('session/new',{cwd:process.cwd(),mcpServers:[]});
        if(session.configOptions.find(c=>c.id==='model').currentValue!==process.env.WB_MODEL)throw Error('wrong default model');
        await call('session/prompt',{sessionId:session.sessionId,prompt:[{type:'text',text:'Reply with the fixture marker. Do not use tools.'}]});
        if(!JSON.stringify(output).includes('PROVIDER_ROUTING_OK'))throw Error('missing model output');
        console.log('NATIVE_PROVIDER_OK');process.exit(0);
      })().catch(e=>{console.error(e.message);process.exit(1)});
    `;
      const { stdout } = await promisify(execFile)(process.execPath, ['-e', script], {
        cwd: root,
        timeout: 45000,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
        env: providers.environment(
          {
            ...process.env,
            GROK_HOME: home,
            GROK_CONFIG: '',
            GROK_CONFIG_PATH: '',
            XAI_API_KEY: '',
            GROK_CODE_XAI_API_KEY: '',
            GROK_DEPLOYMENT_KEY: '',
            GROK_SUBAGENTS: '0',
            WB_ADDON: resolve('.runtime/studio-engine.node'),
            WB_MODEL: providerModel(profile.id),
          },
          profile.id,
        ),
      });
      assert.match(stdout, /NATIVE_PROVIDER_OK/);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].body.model, 'fixture-routing');
      assert.equal(calls[0].authorization, 'Bearer fixture-provider-only');
      const guardedEnv = providers.environment(
        {
          ...process.env,
          GROK_HOME: home,
          GROK_CONFIG: '',
          GROK_CONFIG_PATH: '',
          XAI_API_KEY: 'unrelated-fixture-key',
          GROK_CODE_XAI_API_KEY: '',
          GROK_DEPLOYMENT_KEY: '',
          GROK_XAI_API_BASE_URL: `http://127.0.0.1:${(server.address() as any).port}/v1`,
          GROK_SUBAGENTS: '0',
          WB_ADDON: resolve('.runtime/studio-engine.node'),
          WB_MODEL: providerModel(profile.id),
        },
        profile.id,
      );
      delete guardedEnv[
        'GROK_WORKBENCH_PROVIDER_KEY_' + profile.id.replaceAll('-', '').toUpperCase()
      ];
      const guarded = script.replace(
        'console.error(e.message);process.exit(1)',
        "console.log('NATIVE_PROVIDER_KEY_REQUIRED');process.exit(0)",
      );
      const blocked = await promisify(execFile)(process.execPath, ['-e', guarded], {
        cwd: root,
        timeout: 30000,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
        env: guardedEnv,
      });
      assert.ok(
        calls.slice(1).every((c) => c.authorization === undefined),
        'missing provider key must not forward the unrelated xAI key',
      );
      assert.match(blocked.stdout, /NATIVE_PROVIDER_KEY_REQUIRED/);
      assert.ok(calls.length > 1, 'the local provider must reject unauthenticated inference');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      history.db.close();
    }
  },
);
