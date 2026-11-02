const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const { randomBytes, createHash } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { validateAction } = require('./protocol.cjs');
const token = process.env.WB_DESKTOP_PROBE_TOKEN;
if (!/^[a-f0-9]{64}$/.test(token || '')) throw new Error('Private test broker token missing.');
app.setPath('userData', process.env.WB_DESKTOP_PROBE_USER_DATA);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
let window, server, trial;
const errors = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function html(layout, code, shift, nonce) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><title>Disposable desktop-use probe</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f1f5f9;color:#172033;font:20px Arial}header{padding:22px 30px;background:#172033;color:white}h1{font-size:25px;margin:0 0 8px}header p{font-size:15px;margin:0}.card{position:absolute;left:${layout.cardX}px;top:125px;width:310px;padding:22px;background:white;border:2px solid #94a3b8;border-radius:12px}.code{font:bold 33px monospace;letter-spacing:4px;margin:15px 0}.field{position:absolute;left:${layout.inputX}px;top:330px;width:330px}input{display:block;width:300px;height:48px;font:26px monospace;margin-top:12px;border:2px solid #64748b;padding:6px}button{position:absolute;top:440px;width:145px;height:50px;font:bold 19px Arial;border:2px solid #64748b;border-radius:8px;background:white;color:#172033}#verify{background:#176447;color:white}#status{position:absolute;left:35px;top:530px;font-weight:bold;font-size:19px}
  </style></head><body><header><h1>Desktop capability test — disposable window</h1><p>Use the displayed code, then Verify. No account or personal information is shown.</p></header>
  <section class="card"><div>One-time confirmation code</div><div class="code">${code}</div><small>Copy this exact code into the field below.</small></section>
  <label class="field">Confirmation code<input id="entry" type="text" autocomplete="off" spellcheck="false" maxlength="128"></label>
  <button id="reset" style="left:${layout.buttons[0]}px">Reset</button><button id="verify" style="left:${layout.buttons[1]}px">Verify</button><button id="cancel" style="left:${layout.buttons[2]}px">Cancel</button>
  <div id="status" role="status">Waiting for the confirmation code.</div>
  <script nonce="${nonce}">
  const entry=document.getElementById('entry'),status=document.getElementById('status'),verify=document.getElementById('verify');
  const events=[];let shifted=false,verified=false;
  const record=(kind)=>events.push({kind,value:entry.value});
  entry.addEventListener('input',()=>{record('input');if(${shift}&&!shifted&&entry.value===${JSON.stringify(code)}){shifted=true;verify.style.left='${layout.buttons[2]}px';document.getElementById('cancel').style.left='${layout.buttons[1]}px';status.textContent='Layout changed. Check the current button positions before continuing.';}});
  verify.onclick=()=>{verified=entry.value===${JSON.stringify(code)};status.textContent=verified?'VERIFIED — the task succeeded.':'Incorrect code. Please inspect the screen and try again.';record(verified?'verified':'incorrect');};
  document.getElementById('reset').onclick=()=>{entry.value='';status.textContent='Reset. Enter the displayed code.';record('reset');};
  document.getElementById('cancel').onclick=()=>{status.textContent='Cancelled. You may still enter the code and Verify.';record('cancel');};
  window.probeEvaluation=()=>({verified,shifted,events:events.slice(),value:entry.value,status:status.textContent,input:{x:entry.getBoundingClientRect().x+100,y:entry.getBoundingClientRect().y+20},verify:{x:verify.getBoundingClientRect().x+70,y:verify.getBoundingClientRect().y+25}});
  </script></body></html>`;
}

async function evaluation() {
  if (!trial) throw new Error('No active trial.');
  return window.webContents.executeJavaScript('window.probeEvaluation()');
}
async function action(name, raw) {
  const input = validateAction(name, raw);
  if (!trial || trial.closed || trial.actions.length >= 24)
    throw new Error('Trial action budget exhausted.');
  if (name !== 'screenshot' && !trial.actions.some((a) => a.name === 'screenshot'))
    throw new Error('Inspect the test window first.');
  const event = { number: trial.actions.length + 1, name, input };
  trial.actions.push(event);
  if (name === 'screenshot') {
    const image = await window.webContents.capturePage();
    const png = image.toPNG(),
      size = image.getSize();
    if (size.width !== 900 || size.height !== 600)
      throw new Error(`Unexpected screenshot coordinate scale: ${size.width}x${size.height}.`);
    event.file = `trial-${trial.index}-screen-${event.number}.png`;
    event.sha256 = createHash('sha256').update(png).digest('hex');
    event.verified = (await evaluation()).verified;
    writeFileSync(join(process.env.WB_DESKTOP_PROBE_OUTPUT, event.file), png);
    return {
      content: [
        {
          type: 'text',
          text: 'Disposable test window, 900 × 600 pixels. Origin (0,0) is its top-left. Inspect the image; action responses do not expose UI state.',
        },
        { type: 'image', mimeType: 'image/png', data: png.toString('base64') },
      ],
    };
  }
  window.webContents.focus();
  if (name === 'click') {
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp'])
      window.webContents.sendInputEvent({
        type,
        x: input.x,
        y: input.y,
        button: 'left',
        clickCount: 1,
      });
  } else window.webContents.insertText(input.text);
  await delay(100);
  event.verified = (await evaluation()).verified;
  return {
    content: [{ type: 'text', text: 'Input delivered. Use screenshot to observe the result.' }],
  };
}

app.whenReady().then(async () => {
  window = new BrowserWindow({
    width: 900,
    height: 600,
    useContentSize: true,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  window.webContents.session.on('will-download', (event) => event.preventDefault());
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  server = createServer(async (req, res) => {
    if (
      req.method !== 'POST' ||
      req.url !== '/rpc' ||
      req.headers.authorization !== 'Bearer ' + token
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      let body = '';
      for await (const part of req) {
        body += part;
        if (body.length > 4096) throw new Error('Oversized request.');
      }
      const { name, input } = JSON.parse(body);
      const result = await action(name, input);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      errors.push(String(error.message).slice(0, 400));
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"error":"Probe action refused."}');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  globalThis.desktopProbe = {
    errors,
    endpoint: `http://127.0.0.1:${server.address().port}/rpc`,
    async reset(index, shift) {
      const bytes = randomBytes(8),
        positions = [45, 365, 685];
      for (let i = positions.length - 1; i > 0; i--) {
        const j = bytes[i] % (i + 1);
        [positions[i], positions[j]] = [positions[j], positions[i]];
      }
      trial = {
        index,
        shift,
        code: (randomBytes(4).readUInt32LE() % 900000) + 100000,
        actions: [],
        closed: false,
      };
      const layout = {
        cardX: 40 + (bytes[3] % 400),
        inputX: 45 + (bytes[4] % 400),
        buttons: positions,
      };
      await window.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            html(layout, String(trial.code), shift, randomBytes(16).toString('hex')),
          ),
      );
      window.showInactive();
    },
    async inspect() {
      return { ...trial, evaluation: await evaluation() };
    },
    async finish() {
      trial.closed = true;
      return { ...trial, evaluation: await evaluation() };
    },
  };
  await window.loadURL('about:blank');
});
app.on('window-all-closed', () => {
  server?.close();
  app.quit();
});
