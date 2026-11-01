const fs = require('node:fs'),
  path = require('node:path'),
  cp = require('node:child_process'),
  crypto = require('node:crypto');
async function main() {
  const platform = `${process.platform}-${process.arch}`;
  if (!['win32-x64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'].includes(platform))
    throw new Error(`Unsupported native engine target: ${platform}`);
  require('./engine-source.cjs');
  const env = { ...process.env };
  await require('./protoc.cjs').ensureProtoc(env);
  cp.execFileSync(
    'cargo',
    [
      '+1.95.0',
      'build',
      '--manifest-path',
      'native/studio-engine/Cargo.toml',
      '--release',
      '--locked',
    ],
    { stdio: 'inherit', env },
  );
  fs.mkdirSync('.runtime', { recursive: true });
  const library =
    process.platform === 'win32'
      ? 'grok_studio_engine.dll'
      : process.platform === 'darwin'
        ? 'libgrok_studio_engine.dylib'
        : 'libgrok_studio_engine.so';
  const source = path.join('native/studio-engine/target/release', library),
    destination = '.runtime/studio-engine.node';
  const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  if (
    !fs.existsSync(destination) ||
    crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex') !== sourceHash
  )
    fs.copyFileSync(source, destination);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
  fs.writeFileSync(
    '.runtime/engine.json',
    JSON.stringify(
      {
        revision: '2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8',
        sha256,
        platform,
        bindingVersion: '0.6.0',
      },
      null,
      2,
    ) + '\n',
  );
  fs.mkdirSync('resources/engine', { recursive: true });
  for (const name of ['LICENSE', 'NOTICE']) {
    const from = path.join('upstream/grok-build', name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join('resources/engine', 'GROK-' + name));
  }
  fs.copyFileSync('native/UPSTREAM-CHANGES.md', 'resources/engine/UPSTREAM-CHANGES.md');
  const metadata = JSON.parse(
    cp.execFileSync(
      'cargo',
      [
        '+1.95.0',
        'metadata',
        '--manifest-path',
        'native/studio-engine/Cargo.toml',
        '--locked',
        '--format-version',
        '1',
      ],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    ),
  );
  const notices = [
    'Embedded engine dependency notices. Cargo.lock is the reproducible dependency graph.\n',
  ];
  for (const pkg of metadata.packages) {
    const folder = path.dirname(pkg.manifest_path);
    notices.push(
      `\n${'='.repeat(72)}\n${pkg.name}@${pkg.version}\nLicense: ${pkg.license ?? 'See source notices'}\nSource: ${pkg.repository ?? pkg.source ?? 'pinned Grok Build checkout'}\n`,
    );
    for (const name of fs
      .readdirSync(folder)
      .filter((name) => /^(license|licence|copying|notice)([._-]|$)/i.test(name))) {
      const file = path.join(folder, name);
      if (fs.statSync(file).isFile() && fs.statSync(file).size < 1024 * 1024)
        notices.push(`\n${name}\n${fs.readFileSync(file, 'utf8')}\n`);
    }
  }
  fs.writeFileSync('resources/engine/CARGO-LICENSES.txt', notices.join(''));
  fs.copyFileSync('.runtime/engine.json', 'resources/engine/engine.json');
  if (process.platform === 'win32') require('./msvc-runtime.cjs')();
  console.log('Built embedded Studio engine:', sha256);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
