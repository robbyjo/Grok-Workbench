const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const run = (command, args, options = {}) =>
  cp.execFileSync(command, args, { stdio: 'inherit', ...options });
function sandboxHelper(executable, root) {
  const helper = path.join(path.dirname(executable), 'chrome-sandbox');
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(helper));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  assert.equal(fs.lstatSync(helper).isSymbolicLink(), false);
  run('sudo', ['-n', 'chown', 'root:root', helper]);
  run('sudo', ['-n', 'chmod', '4755', helper]);
  return helper;
}
function smoke(executable) {
  run(
    'dbus-run-session',
    [
      '--',
      'xvfb-run',
      '-a',
      '-s',
      '-screen 0 1440x1000x24',
      process.execPath,
      'scripts/linux-platform-smoke.mjs',
    ],
    {
      env: { ...process.env, GROK_DESKTOP_TEST_EXE: executable || '' },
    },
  );
}
function binaries(root) {
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...binaries(file));
    else if (entry.isFile() && entry.name === 'grok-workbench') found.push(file);
  }
  return found;
}
function main() {
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  const version = require('../package.json').version;
  const source = cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  fs.mkdirSync('.test-data', { recursive: true });
  if (process.argv.includes('--source')) {
    const executable = path.resolve('node_modules/electron/dist/electron');
    const helper = sandboxHelper(executable, path.dirname(executable));
    try {
      smoke();
    } finally {
      run('sudo', ['-n', 'chmod', '0755', helper]);
    }
    return;
  }
  const packages = [
    `Grok-Workbench-${version}-linux-amd64-EXPERIMENTAL.deb`,
    `Grok-Workbench-${version}-linux-x64-EXPERIMENTAL.tar.gz`,
  ];
  const accepted = [];
  for (const name of packages) {
    const file = path.resolve('release', name);
    const manifest = JSON.parse(fs.readFileSync(file + '.manifest.json', 'utf8'));
    assert.equal(manifest.source, source);
    assert.equal(manifest.platform, 'linux-x64');
    assert.equal(manifest.version, version);
    assert.equal(manifest.bytes, fs.statSync(file).size);
    const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(digest, manifest.sha256);
    const directory = fs.mkdtempSync(path.resolve('.test-data/linux-package-'));
    if (name.endsWith('.deb')) {
      run('dpkg-deb', ['--extract', file, directory]);
      const desktop = path.join(directory, 'usr/share/applications/grok-workbench.desktop');
      assert.ok(!fs.readFileSync(desktop, 'utf8').includes('--no-sandbox'));
    } else {
      const entries = cp
        .execFileSync('tar', ['-tzf', file], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
        .split('\n')
        .filter(Boolean);
      assert.ok(
        entries.every((entry) => !entry.startsWith('/') && !entry.split('/').includes('..')),
      );
      run('tar', ['-xzf', file, '-C', directory, '--no-same-owner']);
    }
    const candidates = binaries(directory);
    assert.equal(candidates.length, 1);
    const executable = fs.realpathSync(candidates[0]);
    const relative = path.relative(fs.realpathSync(directory), executable);
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative));
    const helper = sandboxHelper(executable, directory);
    try {
      smoke(executable);
    } finally {
      run('sudo', ['-n', 'chmod', '0755', helper]);
    }
    accepted.push({ file: name, sha256: digest, source, passed: true, chromiumSandbox: true });
  }
  fs.writeFileSync(
    '.test-data/linux-package-acceptance.json',
    JSON.stringify(accepted, null, 2) + '\n',
  );
  console.log('Actual Debian and tar.gz payloads passed sandboxed desktop acceptance.');
}
if (require.main === module) main();
