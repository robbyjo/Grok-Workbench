const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { version } = require('../package.json');
if (!['linux', 'darwin'].includes(process.platform))
  throw new Error(
    'Experimental packages target Linux/macOS. Use the existing Windows build scripts on Windows.',
  );
const kind = process.platform === 'darwin' ? '--mac' : '--linux';
cp.execFileSync(
  process.execPath,
  [
    'node_modules/electron-builder/out/cli/cli.js',
    kind,
    `--${process.arch}`,
    '--config',
    'scripts/experimental-builder.cjs',
    '--publish',
    'never',
  ],
  { stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } },
);
const resources =
  process.platform === 'darwin'
    ? path.resolve(
        'release',
        process.arch === 'arm64' ? 'mac-arm64' : 'mac',
        'Grok Workbench.app/Contents/Resources',
      )
    : path.resolve(
        'release',
        process.arch === 'arm64' ? 'linux-arm64-unpacked' : 'linux-unpacked',
        'resources',
      );
const engine = JSON.parse(
  fs.readFileSync(path.join(resources, 'engine/notices/engine.json'), 'utf8'),
);
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (digest(path.join(resources, 'engine/studio-engine.node')) !== engine.sha256)
  throw new Error('Packaged engine metadata does not match the final addon.');
if (engine.platform !== `${process.platform}-${process.arch}`)
  throw new Error('Packaged engine target mismatch.');
if (process.platform === 'darwin')
  cp.execFileSync(
    'codesign',
    ['--verify', '--deep', '--strict', path.dirname(path.dirname(resources))],
    { stdio: 'inherit' },
  );
const source = cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
for (const name of fs
  .readdirSync('release')
  .filter(
    (name) => name.startsWith(`Grok-Workbench-${version}-`) && /\.(zip|AppImage|deb)$/.test(name),
  )) {
  const file = path.join('release', name),
    sha256 = digest(file);
  const manifest = {
    format: 1,
    product: 'Grok Workbench',
    version,
    platform: engine.platform,
    source,
    sha256,
    bytes: fs.statSync(file).size,
    engineSha256: engine.sha256,
    nativeRevision: engine.revision,
    bindingVersion: engine.bindingVersion,
    experimental: true,
    volunteerTested: false,
    macOSStatus:
      process.platform === 'darwin' ? 'UNTESTED - volunteer validation required' : undefined,
    updates: 'manual only',
    nativePruning: 'disabled pending POSIX lock acceptance',
  };
  fs.writeFileSync(file + '.sha256', sha256 + '  ' + name + '\n');
  fs.writeFileSync(file + '.manifest.json', JSON.stringify(manifest, null, 2) + '\n');
}
fs.copyFileSync('resources/EXPERIMENTAL-PLATFORMS.txt', 'release/EXPERIMENTAL-PLATFORMS.txt');
console.log('Experimental packages created with checksums and provenance; macOS remains UNTESTED.');
