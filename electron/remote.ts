import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import type { Store } from './store';
import type { Wire } from '../shared/types';

export class RemoteAccess {
  private server?: Server;
  private token?: string;
  private origin?: string;
  private port?: number;
  private projects = new Set<string>();
  private control = false;
  private starting = false;
  private requests = new Map<string, { hash: string; result: Wire }>();
  private requestCount = 0;
  private windowAt = Date.now();
  private audit: Array<{ at: string; action: string; threadId?: string }> = [];
  constructor(
    private store: Store,
    private submit: (id: string, text: string, key: string) => Promise<Wire>,
    private stopTurn: (id: string) => void,
    private changed = () => {},
  ) {}
  status() {
    return {
      running: !!this.server?.listening,
      port: this.port,
      localUrl: this.port ? `http://127.0.0.1:${this.port}` : undefined,
      publicUrl: this.origin,
      projectIds: [...this.projects],
      control: this.control,
      audit: this.audit.slice(-30),
    };
  }
  async start(input: Wire) {
    if (this.server || this.starting)
      throw new Error('Stop remote access before changing its scope.');
    if (
      !Array.isArray(input.projectIds) ||
      !input.projectIds.length ||
      input.projectIds.length > 100 ||
      new Set(input.projectIds).size !== input.projectIds.length
    )
      throw new Error('Choose the projects to share.');
    const projects = input.projectIds.map((id: string) => this.store.project(id));
    if (projects.some((p) => p.hidden)) throw new Error('Restore shared projects first.');
    let origin: string | undefined;
    if (input.publicUrl) {
      const url = new URL(input.publicUrl);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
      )
        throw new Error('Enter the HTTPS origin of your secure tunnel, without a path.');
      origin = url.origin;
    }
    const port = input.port ?? 0;
    if (!Number.isInteger(port) || port < 0 || port > 65535 || (port > 0 && port < 1024))
      throw new Error('Use an available port from 1024–65535, or zero for automatic.');
    this.starting = true;
    const server = createServer((req, res) => void this.handle(req, res));
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    server.maxHeadersCount = 30;
    server.on('clientError', (_err, socket) =>
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'),
    );
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      this.server = server;
      this.port = (server.address() as { port: number }).port;
      this.token = randomBytes(32).toString('base64url');
      this.origin = origin;
      this.projects = new Set(projects.map((p) => p.id));
      this.control = input.control === true;
      this.requests.clear();
      this.requestCount = 0;
      this.windowAt = Date.now();
      this.log('started');
      return { ...this.status(), token: this.token };
    } finally {
      this.starting = false;
    }
  }
  stop() {
    this.token = undefined;
    const server = this.server;
    this.server = undefined;
    this.port = undefined;
    server?.closeAllConnections();
    server?.close();
    this.projects.clear();
    this.requests.clear();
    this.log('stopped');
  }
  private log(action: string, threadId?: string) {
    this.audit = [...this.audit.slice(-99), { at: new Date().toISOString(), action, threadId }];
    this.changed();
  }
  private authorized(req: IncomingMessage) {
    if (!this.token) return false;
    const provided = req.headers.authorization;
    const expected = `Bearer ${this.token}`;
    return (
      typeof provided === 'string' &&
      provided.length === expected.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    );
  }
  private thread(id: string) {
    const t = this.store.thread(id);
    if (!this.projects.has(t.projectId) || t.archived || this.store.project(t.projectId).hidden)
      throw new Error('Session unavailable.');
    return t;
  }
  private async body(req: IncomingMessage) {
    if (req.headers['content-type'] !== 'application/json')
      throw new Error('Use application/json.');
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 64 * 1024) throw new Error('Request exceeds 64 KiB.');
      chunks.push(chunk);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Use a JSON object.');
    return value;
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${createHash('sha256').update(mobileScript).digest('base64')}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    };
    const respond = (status: number, data: unknown) => {
      if (!res.headersSent)
        res.writeHead(status, { ...headers, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    try {
      const host = req.headers.host ?? '';
      const hosts = [
        `127.0.0.1:${this.port}`,
        `localhost:${this.port}`,
        ...(this.origin ? [new URL(this.origin).host] : []),
      ];
      if (!hosts.includes(host)) {
        respond(403, { error: 'Host not allowed.' });
        return;
      }
      const allowedOrigins = [
        `http://127.0.0.1:${this.port}`,
        `http://localhost:${this.port}`,
        this.origin,
      ];
      if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) {
        respond(403, { error: 'Origin not allowed.' });
        return;
      }
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/') {
        res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
        res.end(mobilePage);
        return;
      }
      if (Date.now() - this.windowAt > 60000) {
        this.windowAt = Date.now();
        this.requestCount = 0;
      }
      if (++this.requestCount > 240) {
        respond(429, { error: 'Rate limit reached. Retry in a minute.' });
        return;
      }
      if (!this.authorized(req)) {
        respond(401, { error: 'Pair with the token shown in Workbench.' });
        return;
      }
      if (req.method === 'GET' && path === '/v1/sessions') {
        respond(200, {
          control: this.control,
          sessions: this.store.state.threads
            .filter(
              (t) =>
                this.projects.has(t.projectId) &&
                !t.archived &&
                !this.store.project(t.projectId).hidden,
            )
            .slice(0, 200)
            .map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              project: this.store.project(t.projectId).name,
              updatedAt: t.updatedAt,
            })),
        });
        return;
      }
      const match = /^\/v1\/sessions\/([a-zA-Z0-9-]{1,100})(?:\/(turns|cancel))?$/.exec(path);
      if (!match) {
        respond(404, { error: 'Unknown endpoint.' });
        return;
      }
      const thread = this.thread(match[1]);
      if (req.method === 'GET' && !match[2]) {
        const page = this.store.page(thread.id);
        let budget = 100000;
        const entries = page.entries
          .filter((e) => ['user', 'assistant', 'notice'].includes(e.type))
          .slice(-60)
          .reverse()
          .map((e) => {
            const text = e.text.slice(0, Math.min(20000, Math.max(0, budget)));
            budget -= text.length;
            return { id: e.id, type: e.type, text };
          })
          .reverse();
        respond(200, {
          id: thread.id,
          title: thread.title,
          status: thread.status,
          entries,
          pendingApprovals: thread.status === 'approval',
          notice: 'Approvals and questions are handled in the desktop app.',
        });
        return;
      }
      if (req.method !== 'POST') {
        respond(405, { error: 'Method not allowed.' });
        return;
      }
      if (!this.control) {
        respond(403, { error: 'Remote control is disabled. Enable it in the desktop app.' });
        return;
      }
      const body = await this.body(req);
      if (match[2] === 'cancel') {
        this.stopTurn(thread.id);
        this.log('cancel', thread.id);
        respond(200, { stopped: true });
        return;
      }
      if (match[2] !== 'turns') {
        respond(404, { error: 'Unknown endpoint.' });
        return;
      }
      if (
        typeof body.text !== 'string' ||
        !body.text.trim() ||
        body.text.length > 20000 ||
        body.text.includes('\0')
      )
        throw new Error('Enter up to 20,000 characters.');
      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(key))
        throw new Error('Provide an Idempotency-Key header (16–100 letters/digits/dashes).');
      const hash = createHash('sha256')
        .update(thread.id + '\0' + body.text)
        .digest('hex');
      const old = this.requests.get(key);
      if (old) {
        respond(
          old.hash === hash ? 200 : 409,
          old.hash === hash ? old.result : { error: 'Key already used for a different request.' },
        );
        return;
      }
      if (this.requests.size >= 200) {
        respond(429, {
          error: 'Pairing reached its 200-turn limit. Restart remote access in Workbench.',
        });
        return;
      }
      // Reserve before awaiting dispatch: concurrent retries cannot execute twice.
      const record = { hash, result: { pending: true } as Wire };
      this.requests.set(key, record);
      try {
        record.result = await this.submit(thread.id, body.text, key);
        this.log('turn', thread.id);
        respond(202, record.result);
      } catch {
        record.result = {
          error:
            'Turn could not start. Check the desktop app; use a new key only after checking the session.',
        };
        respond(409, record.result);
      }
    } catch {
      respond(400, {
        error: 'Request failed. Check its fields, shared project scope, and session status.',
      });
    }
  }
}
const mobileScript = `
let token='', selected='', timer, pendingKey;
const $=id=>document.getElementById(id);
async function api(path,opts={}) { const r=await fetch(path,{...opts,headers:{'Authorization':'Bearer '+token,...opts.headers}}); const v=await r.json(); if(!r.ok) throw Error(v.error||'Request failed'); return v; }
function message(s){$('status').textContent=s;}
async function refresh(){if(!token)return; try {const v=await api('/v1/sessions'); const list=$('sessions'); const previous=list.value; list.replaceChildren(); for(const s of v.sessions){const o=document.createElement('option');o.value=s.id;o.textContent=s.project+' / '+s.title+' ('+s.status+')';list.append(o);}list.value=v.sessions.some(s=>s.id===previous)?previous:(v.sessions[0]?.id||''); selected=list.value; $('controls').hidden=!v.control; await show();}catch(e){message(e.message);}}
async function show(){selected=$('sessions').value;if(!selected){$('entries').textContent='No shared chats. Create a chat on the desktop.';return;}const v=await api('/v1/sessions/'+selected);$('entries').replaceChildren();for(const e of v.entries){const p=document.createElement('p');const b=document.createElement('strong');b.textContent=e.type+': ';p.append(b,document.createTextNode(e.text));$('entries').append(p);}message(v.status+(v.pendingApprovals?' — respond on desktop':''));}
$('pair').onclick=async()=>{token=$('token').value.trim();$('token').value='';await refresh();clearInterval(timer);timer=setInterval(()=>void refresh(),5000);};
$('sessions').onchange=()=>show().catch(e=>message(e.message));
$('send').onclick=async()=>{const text=$('prompt').value;if(!text.trim()||!selected)return; $('send').disabled=true;pendingKey||=crypto.randomUUID();try{const v=await api('/v1/sessions/'+selected+'/turns',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':pendingKey},body:JSON.stringify({text})});if(v.error)throw Error(v.error);$('prompt').value='';pendingKey=undefined;$('reset').hidden=true;message('Turn started');}catch(e){$('reset').hidden=false;message(e.message+' Check the chat before retrying.');}finally{$('send').disabled=false;}};
$('reset').onclick=()=>{pendingKey=undefined;$('reset').hidden=true;message('New request ready. Send when ready.');};
$('cancel').onclick=()=>api('/v1/sessions/'+selected+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(()=>message('Stop requested')).catch(e=>message(e.message));
$('unpair').onclick=()=>{token='';clearInterval(timer);$('entries').replaceChildren();message('Disconnected');};
`;
const mobilePage = `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Grok Workbench Remote</title><style>body{font:16px system-ui;background:#111315;color:#dce0e2;max-width:900px;margin:auto;padding:20px}button,input,select,textarea{font:inherit;padding:10px;max-width:100%;box-sizing:border-box;margin:5px 0}input,select,textarea{width:100%}p{white-space:pre-wrap;overflow-wrap:anywhere}#entries{border-block:1px solid #65717a;padding:12px 0}button{cursor:pointer}small{display:block}</style><h1>Grok Workbench Remote</h1><label>Pairing token<input id="token" type="password" autocomplete="off"></label><button id="pair">Connect</button> <button id="unpair">Disconnect</button><small>The token stays in memory until disconnect or page reload. Share only over HTTPS or an SSH tunnel.</small><label>Chat<select id="sessions"></select></label><p role="status" id="status">Connect with the token from desktop Settings → Remote access.</p><main id="entries"></main><section id="controls" hidden><label>Prompt<textarea id="prompt" rows="5" maxlength="20000"></textarea></label><button id="send">Send</button> <button id="cancel">Stop turn</button><button id="reset" hidden>I checked the chat — start a new request</button><small>Tool approvals and questions remain on the desktop.</small></section><script>${mobileScript}</script></html>`;
