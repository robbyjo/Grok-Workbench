const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const pins = {
  'win32-x64': ['win64', '6d7ebdc75e9c1f0026d4fb28f17ef1d0aae77d36744d83a9e052d79ba493724f'],
  'linux-x64': ['linux-x86_64', 'af27ea66cd26938fe48587804ca7d4817457a08350021a1c6e23a27ccc8c6904'],
  'linux-arm64': [
    'linux-aarch_64',
    '31c5e9e3c7bf013cf41fb97765ee255c140024a6b175b6cc9b64beddd7c23ba7',
  ],
  'darwin-x64': ['osx-x86_64', 'ab124429c1f49951f03b6c0c0e911fec04e2c7c20de5c935e0cde7353bbd016c'],
  'darwin-arm64': [
    'osx-aarch_64',
    '2c7e92b8b578916937df132b3032e2e8e6c170862ecf7a8333094a6f3d03650c',
  ],
};
async function ensureProtoc(env) {
  if (env.PROTOC) return;
  if (process.platform === 'win32') {
    try {
      cp.execFileSync('protoc', ['--version'], { stdio: 'ignore' });
      return;
    } catch {}
  }
  const pin = pins[`${process.platform}-${process.arch}`];
  if (!pin) throw new Error('No pinned protoc for this build host. Set PROTOC explicitly.');
  const folder = path.resolve('.runtime/protoc');
  fs.mkdirSync(folder, { recursive: true });
  const zip = path.join(folder, 'protoc.zip');
  let bytes = fs.existsSync(zip) ? fs.readFileSync(zip) : undefined;
  const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
  if (!bytes || hash(bytes) !== pin[1]) {
    const response = await fetch(
      `https://github.com/protocolbuffers/protobuf/releases/download/v34.1/protoc-34.1-${pin[0]}.zip`,
      { signal: AbortSignal.timeout(180000) },
    );
    if (!response.ok) throw new Error('Could not download pinned protoc. Set PROTOC explicitly.');
    bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== pin[1]) throw new Error('Pinned protobuf checksum mismatch.');
    fs.writeFileSync(zip, bytes);
  }
  if (process.platform === 'win32') {
    cp.execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$ErrorActionPreference='Stop';$env:PSModulePath=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/Modules';Expand-Archive -LiteralPath $env:GROK_STUDIO_PROTO_ZIP -DestinationPath $env:GROK_STUDIO_PROTO_DIR -Force",
      ],
      {
        env: { ...env, GROK_STUDIO_PROTO_ZIP: zip, GROK_STUDIO_PROTO_DIR: folder },
        stdio: 'inherit',
      },
    );
  } else cp.execFileSync('unzip', ['-q', '-o', zip, '-d', folder], { stdio: 'inherit' });
  env.PROTOC = path.join(folder, 'bin', process.platform === 'win32' ? 'protoc.exe' : 'protoc');
  if (process.platform !== 'win32') fs.chmodSync(env.PROTOC, 0o755);
  console.log(cp.execFileSync(env.PROTOC, ['--version'], { encoding: 'utf8' }).trim());
}
module.exports = { ensureProtoc, pins };
