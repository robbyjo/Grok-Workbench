const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const repository = 'robbyjo/Grok-Workbench';
const revision = '2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8';
const tar =
  process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/tar.exe')
    : 'tar';
const gh = (...args) =>
  cp.execFileSync('gh', args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const api = (endpoint) => JSON.parse(gh('api', endpoint));
async function fileHash(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function validateRun(run, head, platform = 'windows') {
  const allowed = {
    windows: { label: 'Windows', workflow: 'windows.yml', branches: ['main'] },
    linux: { label: 'Linux', workflow: 'experimental-linux.yml', branches: ['main'] },
    macos: {
      label: 'macOS',
      workflow: 'experimental-macos.yml',
      branches: ['main', 'codex/linux-macos-builds'],
    },
  }[platform];
  if (
    !allowed ||
    !/^[a-f0-9]{40}$/.test(head || '') ||
    run.head_sha !== head ||
    !allowed.branches.includes(run.head_branch) ||
    !['push', 'workflow_dispatch'].includes(run.event) ||
    run.conclusion !== 'success' ||
    run.status !== 'completed' ||
    run.path !== '.github/workflows/' + allowed.workflow ||
    run.repository?.full_name !== repository
  )
    throw new Error(
      `Release requires a successful trusted ${allowed?.label || platform} run for this exact main commit.`,
    );
}
function validateManifest(manifest, { version, head, platform, sha256, bytes }) {
  if (
    manifest.format !== 1 ||
    manifest.product !== 'Grok Workbench' ||
    manifest.version !== version ||
    manifest.source !== head ||
    manifest.platform !== platform ||
    manifest.sha256 !== sha256 ||
    manifest.bytes !== bytes ||
    manifest.nativeRevision !== revision ||
    manifest.bindingVersion !== '0.6.0' ||
    !/^[a-f0-9]{64}$/.test(manifest.engineSha256 || '') ||
    manifest.experimental !== true ||
    manifest.volunteerTested !== false ||
    manifest.updates !== 'manual only' ||
    (platform.startsWith('darwin-') && !String(manifest.macOSStatus).startsWith('UNTESTED'))
  )
    throw new Error(
      'Experimental artifact source/version/platform/checksum contract failed verification.',
    );
}
async function entryHash(file, entry) {
  const child = cp.spawn(tar, ['-xOf', file, entry], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let errorText = '',
    header = Buffer.alloc(0);
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(errorText || 'Archive extraction failed.')),
    );
  });
  void closed.catch(() => {});
  child.stderr.on('data', (part) => (errorText = (errorText + part).slice(-8000)));
  const hash = crypto.createHash('sha256');
  for await (const chunk of child.stdout) {
    hash.update(chunk);
    if (header.length < 64) header = Buffer.concat([header, chunk.subarray(0, 64 - header.length)]);
  }
  await closed;
  return { sha256: hash.digest('hex'), header };
}
function download(runId, name, folder, expected) {
  const artifacts = api(`repos/${repository}/actions/runs/${runId}/artifacts`).artifacts;
  if (artifacts.filter((item) => item.name === name && !item.expired).length !== 1)
    throw new Error('Exact platform artifact is unavailable.');
  fs.mkdirSync(folder, { recursive: true });
  gh('run', 'download', String(runId), '--repo', repository, '--name', name, '--dir', folder);
  if (fs.readdirSync(folder).sort().join('|') !== [...expected].sort().join('|'))
    throw new Error('Unexpected platform artifact contents.');
}
async function verifyPackagedEngine(file, platform, expectedSha256, root) {
  const name = path.basename(file);
  let archive = file,
    prefix;
  if (name.endsWith('.deb')) {
    const members = cp.execFileSync(tar, ['-tf', file], { encoding: 'utf8' }).trim().split(/\r?\n/);
    const data = members.filter((member) => /^data\.tar\.(xz|gz|zst)$/.test(member));
    if (data.length !== 1) throw new Error('Debian data archive is missing or ambiguous.');
    archive = path.join(root, 'linux-data.' + data[0].split('.').at(-1));
    const descriptor = fs.openSync(archive, 'w');
    try {
      cp.execFileSync(tar, ['-xOf', file, data[0]], {
        stdio: ['ignore', descriptor, 'pipe'],
        windowsHide: true,
      });
    } finally {
      fs.closeSync(descriptor);
    }
    prefix = 'opt/Grok-Workbench/resources/engine/';
  } else
    prefix = platform.startsWith('darwin-')
      ? 'Grok Workbench.app/Contents/Resources/engine/'
      : name.replace(/\.tar\.gz$/, '') + '/resources/engine/';
  const entries = cp
    .execFileSync(tar, ['-tf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    .split(/\r?\n/);
  const entry = entries.find((item) => item.replace(/^\.\//, '') === prefix + 'studio-engine.node');
  if (!entry) throw new Error('Packaged native engine is missing.');
  const engine = await entryHash(archive, entry);
  if (engine.sha256 !== expectedSha256) throw new Error('Packaged native engine checksum differs.');
  if (platform.startsWith('darwin-')) {
    const cpu = platform.endsWith('arm64') ? 0x0100000c : 0x01000007;
    if (engine.header.readUInt32LE(0) !== 0xfeedfacf || engine.header.readUInt32LE(4) !== cpu)
      throw new Error('Mac native engine architecture differs.');
  } else if (engine.header.readUInt32LE(0) !== 0x464c457f || engine.header.readUInt16LE(18) !== 62)
    throw new Error('Linux native engine architecture differs.');
  return engine.sha256;
}
async function collectExperimental({ root, version, head, linuxRunId, macosRunId }) {
  const linux = [
    `Grok-Workbench-${version}-linux-amd64-EXPERIMENTAL.deb`,
    `Grok-Workbench-${version}-linux-x64-EXPERIMENTAL.tar.gz`,
  ];
  const textName = 'EXPERIMENTAL-PLATFORMS.txt';
  const names = (files) => [
    ...files.flatMap((file) => [file, file + '.sha256', file + '.manifest.json']),
    textName,
  ];
  const linuxFolder = path.join(root, 'linux');
  download(linuxRunId, `Grok-Workbench-Linux-x64-${head}`, linuxFolder, names(linux));
  const groups = [{ folder: linuxFolder, platform: 'linux-x64', files: linux }];
  for (const arch of ['arm64', 'x64']) {
    const file = `Grok-Workbench-${version}-macOS-${arch}-UNTESTED.zip`,
      folder = path.join(root, 'macos-' + arch);
    download(macosRunId, `Grok-Workbench-macOS-${arch}-UNTESTED-${head}`, folder, names([file]));
    if (
      fs.readFileSync(path.join(folder, textName), 'utf8') !==
      fs.readFileSync(path.join(linuxFolder, textName), 'utf8')
    )
      throw new Error('Platform notices differ.');
    groups.push({ folder, platform: 'darwin-' + arch, files: [file] });
  }
  const assets = [path.join(linuxFolder, textName)],
    packages = [];
  for (const group of groups)
    for (const name of group.files) {
      const file = path.join(group.folder, name),
        sha256 = await fileHash(file),
        bytes = fs.statSync(file).size;
      const manifest = JSON.parse(fs.readFileSync(file + '.manifest.json', 'utf8'));
      validateManifest(manifest, { version, head, platform: group.platform, sha256, bytes });
      if (fs.readFileSync(file + '.sha256', 'utf8').trim() !== sha256 + '  ' + name)
        throw new Error('Platform checksum sidecar does not match.');
      await verifyPackagedEngine(file, group.platform, manifest.engineSha256, root);
      assets.push(file, file + '.manifest.json', file + '.sha256');
      packages.push({
        file: name,
        platform: group.platform,
        bytes,
        sha256,
        engineSha256: manifest.engineSha256,
        volunteerTested: false,
      });
    }
  if (packages[0].engineSha256 !== packages[1].engineSha256)
    throw new Error('Linux packages embed different engines.');
  return { assets, packages };
}
module.exports = {
  verifyPackagedEngine,
  validateRun,
  validateManifest,
  collectExperimental,
  fileHash,
  revision,
};
