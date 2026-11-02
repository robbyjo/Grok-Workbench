const { join } = require('node:path');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'win32') process.exit(0);
const root = join(__dirname, '..');
const runtime = join(root, '.runtime');
mkdirSync(runtime, { recursive: true });
const framework = join(
  process.env.WINDIR || 'C:\\Windows',
  'Microsoft.NET',
  'Framework64',
  'v4.0.30319',
);
const source = join(root, 'native', 'desktop-control.cs');
const output = join(runtime, 'desktop-control.exe');
execFileSync(
  join(framework, 'csc.exe'),
  [
    '/nologo',
    '/target:exe',
    '/platform:anycpu',
    '/optimize+',
    '/out:' + output,
    '/r:System.Drawing.dll',
    '/r:System.Web.Extensions.dll',
    '/r:' + join(framework, 'WPF', 'WindowsBase.dll'),
    '/r:' + join(framework, 'WPF', 'UIAutomationClient.dll'),
    '/r:' + join(framework, 'WPF', 'UIAutomationTypes.dll'),
    source,
  ],
  { stdio: 'inherit', windowsHide: true },
);
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
writeFileSync(
  join(runtime, 'desktop-control.json'),
  JSON.stringify({ sourceSha256: hash(source), sha256: hash(output) }, null, 2) + '\n',
);
const applicationSource = join(root, 'native', 'application-worker.cs');
const applicationOutput = join(runtime, 'application-worker.exe');
execFileSync(
  join(framework, 'csc.exe'),
  [
    '/nologo',
    '/target:exe',
    '/platform:anycpu',
    '/optimize+',
    '/out:' + applicationOutput,
    '/r:System.Web.Extensions.dll',
    '/r:Microsoft.CSharp.dll',
    applicationSource,
  ],
  { stdio: 'inherit', windowsHide: true },
);
writeFileSync(
  join(runtime, 'application-worker.json'),
  JSON.stringify(
    { sourceSha256: hash(applicationSource), sha256: hash(applicationOutput) },
    null,
    2,
  ) + '\n',
);
