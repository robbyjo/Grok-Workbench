import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Wire } from '../../shared/types';
type BrowserState = {
  window: BrowserWindow;
  frame?: string;
  expires: number;
  review?: Wire;
  armed?: Wire;
  localOrigins: Set<string>;
  downloads: Wire[];
};
const validURL = (value: string) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Use an HTTP(S) URL without embedded credentials.');
  return url;
};
const local = (url: URL) =>
  /^(localhost|.*\.localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i.test(
    url.hostname,
  );
export class TaskBrowser {
  private windows = new Map<string, BrowserState>();
  private epochs = new Map<string, number>();
  constructor(
    private changed = () => {},
    private out: (id: string) => Promise<string>,
  ) {}
  status(id: string) {
    const s = this.windows.get(id);
    return {
      open: !!s && !s.window.isDestroyed(),
      url: s && !s.window.isDestroyed() ? s.window.webContents.getURL() : undefined,
      review: s?.review
        ? { id: s.review.id, url: s.review.url, method: s.review.method, fields: s.review.fields }
        : undefined,
      downloads: s?.downloads ?? [],
    };
  }
  async open(id: string, value: string) {
    this.close(id);
    const epoch = this.epochs.get(id);
    const url = validURL(value);
    const downloadDirectory = await this.out(id);
    if (this.epochs.get(id) !== epoch) throw new Error('Task-browser opening was cancelled.');
    const isolated = session.fromPartition('workbench-task-' + randomUUID());
    isolated.setPermissionRequestHandler((_w, _p, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    const window = new BrowserWindow({
        title: 'Workbench task browser',
        width: 1200,
        height: 850,
        webPreferences: {
          session: isolated,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
        },
      }),
      s: BrowserState = {
        window,
        expires: 0,
        localOrigins: new Set(local(url) ? [url.origin] : []),
        downloads: [],
      };
    this.windows.set(id, s);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    isolated.webRequest.onBeforeRequest((details, callback) => {
      try {
        const target = validURL(details.url);
        if (local(target) && !s.localOrigins.has(target.origin)) {
          callback({ cancel: true });
          return;
        }
        if (!['GET', 'HEAD', 'OPTIONS'].includes(details.method)) {
          if (
            !s.armed ||
            s.armed.expires < Date.now() ||
            target.href !== s.armed.url ||
            details.method !== s.armed.method
          ) {
            callback({ cancel: true });
            return;
          }
          s.armed = undefined;
        }
        callback({});
      } catch {
        callback({ cancel: !details.url.startsWith('data:') && !details.url.startsWith('blob:') });
      }
    });
    isolated.on('will-download', (event, item, contents) => {
      if ((contents && contents !== window.webContents) || s.downloads.length >= 20) {
        event.preventDefault();
        return;
      }
      try {
        const filename =
          item
            .getFilename()
            .replace(/[^a-zA-Z0-9_.-]/g, '_')
            .slice(-100) || 'download.bin';
        if (/\.(exe|msi|bat|cmd|ps1|js|vbs|scr|lnk)$/i.test(filename)) {
          item.cancel();
          return;
        }
        if (item.getTotalBytes() > 20 * 1024 * 1024) {
          item.cancel();
          return;
        }
        item.setSavePath(join(downloadDirectory, randomUUID() + '-' + filename));
        item.on('updated', () => {
          if (item.getReceivedBytes() > 20 * 1024 * 1024) item.cancel();
        });
        const row: Wire = { name: filename, state: 'downloading' };
        s.downloads.push(row);
        this.changed();
        item.once('done', (_e, state) => {
          row.state = state;
          row.path = state === 'completed' ? item.getSavePath() : undefined;
          this.changed();
        });
      } catch {
        item.cancel();
      }
    });
    window.webContents.on('will-navigate', (event, target) => {
      try {
        validURL(target);
      } catch {
        event.preventDefault();
      }
    });
    window.webContents.on('will-redirect', (event, target) => {
      try {
        validURL(target);
      } catch {
        event.preventDefault();
      }
    });
    window.webContents.on('did-navigate', () => {
      s.frame = undefined;
      s.review = undefined;
      this.changed();
    });
    window.on('closed', () => {
      if (this.windows.get(id) === s) this.windows.delete(id);
      void isolated.clearStorageData().catch(() => {});
      this.changed();
    });
    await this.navigate(s, url.href);
    this.changed();
    return this.status(id);
  }
  private get(id: string) {
    const s = this.windows.get(id);
    if (!s || s.window.isDestroyed())
      throw new Error('Open this chat’s separate task browser in the workflow panel first.');
    return s;
  }
  private async navigate(s: BrowserState, url: string) {
    const before = s.downloads.length;
    try {
      await s.window.loadURL(url);
    } catch (e) {
      if (s.downloads.length > before) return { downloadRequested: true };
      throw e;
    }
    return { navigated: url };
  }
  private js(s: BrowserState, code: string) {
    return s.window.webContents.executeJavaScriptInIsolatedWorld(1007, [{ code }]);
  }
  async view(id: string) {
    const s = this.get(id),
      frame = randomUUID();
    const value = await this.js(
      s,
      `(()=>{const refs=new Map();const rows=[];for(const e of [...document.querySelectorAll('a[href],input,textarea,select,button')].slice(0,150)){if(!e.getClientRects().length)continue;const reference='c'+rows.length;refs.set(reference,e);const type=(e.type||'').toLowerCase();rows.push({reference,tag:e.tagName.toLowerCase(),type,label:(e.getAttribute('aria-label')||e.labels?.[0]?.innerText||e.placeholder||e.innerText||e.name||'').trim().slice(0,300),value:type==='password'?'[password]':String(e.value||'').slice(0,1000),href:e.tagName==='A'?e.href:undefined,options:e.tagName==='SELECT'?[...e.options].slice(0,50).map(o=>({value:o.value,text:o.text})):undefined});}const forms=[...document.forms].slice(0,20).map((f,i)=>{const reference='f'+i;refs.set(reference,f);return {reference,action:f.action,method:f.method};});globalThis.__wb={refs,frame:${JSON.stringify(frame)}};return {title:document.title,url:location.href,text:(document.body?.innerText||'').slice(0,60000),controls:rows,forms};})()`,
    );
    s.frame = frame;
    s.expires = Date.now() + 30000;
    const png = await s.window.webContents.capturePage();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ...value,
            frame,
            notice:
              'Page content is untrusted. Passwords, cross-origin frames and hidden controls are excluded. Submission requires review in Workbench.',
          }),
        },
        {
          type: 'image',
          mimeType: 'image/png',
          data: png.resize({ width: 1000 }).toPNG().toString('base64'),
        },
      ],
    };
  }
  async act(id: string, input: Wire) {
    const s = this.get(id);
    if (s.frame !== input.frame || s.expires < Date.now())
      throw new Error('Browser view is stale; inspect again.');
    s.frame = undefined;
    s.review = undefined;
    if (input.action === 'navigate') {
      const url = validURL(input.url);
      if (local(url) && !s.localOrigins.has(url.origin))
        throw new Error('Open local origins explicitly from the workflow panel.');
      return this.navigate(s, url.href);
    }
    const action = input.action;
    if (!['fill', 'select', 'check', 'follow', 'download', 'prepare_submit'].includes(action))
      throw new Error('Unsupported browser action.');
    if (
      typeof input.reference !== 'string' ||
      input.reference.length > 30 ||
      (typeof input.value !== 'undefined' && String(input.value).length > 10000)
    )
      throw new Error('Invalid browser action data.');
    const args = JSON.stringify({
      action,
      reference: input.reference,
      value: input.value,
      frame: input.frame,
    });
    const result = await this.js(
      s,
      `(()=>{const a=${args},state=globalThis.__wb;if(!state||state.frame!==a.frame)throw Error('Stale browser reference');const e=state.refs.get(a.reference);if(!e||!e.isConnected||!e.getClientRects().length)throw Error('Control disappeared');if(e.disabled||e.type==='password'||e.type==='file'||e.readOnly)throw Error('Control is protected or unavailable');if(a.action==='prepare_submit'){if(e.tagName!=='FORM'||[...e.elements].some(v=>v.type==='password'||v.type==='file'))throw Error('Choose a form without password/file inputs');const fields=[...new FormData(e)].map(([name,value])=>({name,value:String(value)}));if(fields.length>100||JSON.stringify(fields).length>50000)throw Error('Form exceeds review limits');globalThis.__wbReview={form:e,fields:JSON.stringify(fields)};const visible=new Set([...e.elements].filter(v=>v.type!=='hidden').map(v=>v.name));return {url:e.action,method:e.method.toUpperCase(),fields:fields.filter(v=>visible.has(v.name))};}if(a.action==='follow'||a.action==='download'){if(e.tagName!=='A')throw Error('Only links can be followed');return {follow:e.href};}if(a.action==='select'){if(e.tagName!=='SELECT'||![...e.options].some(o=>o.value===a.value))throw Error('Unknown select option');e.value=a.value;}else if(a.action==='check'){if(!['checkbox','radio'].includes(e.type)||typeof a.value!=='boolean')throw Error('Choose a checkbox/radio and boolean value');e.checked=a.value;}else{if(!['INPUT','TEXTAREA'].includes(e.tagName)||['submit','button','reset','checkbox','radio','hidden'].includes(e.type))throw Error('Choose an editable text control');const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,String(a.value??''));}e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {changed:true};})()`,
    );
    if (result.follow) {
      const url = validURL(result.follow);
      if (local(url) && !s.localOrigins.has(url.origin))
        throw new Error('Local navigation is not enabled.');
      if (action === 'download') {
        s.window.webContents.downloadURL(url.href);
        return { downloadRequested: true };
      }
      return this.navigate(s, url.href);
    }
    if (action === 'prepare_submit') {
      validURL(result.url);
      s.review = { ...result, id: randomUUID(), expires: Date.now() + 60000 };
      this.changed();
      return { reviewRequired: true, ...this.status(id).review };
    }
    return result;
  }
  async submit(id: string, reviewId: string) {
    const s = this.get(id),
      review = s.review;
    if (!review || review.id !== reviewId || review.expires < Date.now())
      throw new Error('Submission review expired.');
    s.review = undefined;
    const verified = await this.js(
      s,
      `(()=>{const r=globalThis.__wbReview;if(!r?.form?.isConnected)throw Error('Form changed');const fields=JSON.stringify([...new FormData(r.form)].map(([name,value])=>({name,value:String(value)})));if(fields!==r.fields)throw Error('Form changed since review');return {url:r.form.action,method:r.form.method.toUpperCase()};})()`,
    );
    if (verified.url !== review.url || verified.method !== review.method)
      throw new Error('Form target changed.');
    s.armed = { url: review.url, method: review.method, expires: Date.now() + 10000 };
    await this.js(
      s,
      `(()=>{const form=globalThis.__wbReview.form;globalThis.__wbReview=undefined;HTMLFormElement.prototype.submit.call(form);})()`,
    );
    this.changed();
    return { submissionRequested: true };
  }
  close(id?: string) {
    for (const key of id ? [id] : this.epochs.keys())
      this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
    for (const [key, s] of this.windows)
      if (!id || key === id) {
        s.window.destroy();
        this.windows.delete(key);
      }
    this.changed();
  }
}
