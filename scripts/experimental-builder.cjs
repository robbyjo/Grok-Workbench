const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const base = require('../package.json').build;
module.exports = {
  ...base,
  files: base.files.filter((file) => file !== 'scripts/portable-update-worker.ps1'),
  extraFiles: [],
  extraResources: [
    { from: '.runtime/studio-engine.node', to: 'engine/studio-engine.node' },
    {
      from: 'resources/engine',
      to: 'engine/notices',
      filter: ['**/*', '!MSVC-REDIST.txt', '!msvc-runtime.json'],
    },
    { from: 'resources/EXPERIMENTAL-PLATFORMS.txt', to: 'EXPERIMENTAL-PLATFORMS.txt' },
  ],
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Development',
    executableName: 'grok-workbench',
    maintainer: 'Grok Workbench contributors',
    artifactName: 'Grok-Workbench-${version}-linux-${arch}-EXPERIMENTAL.${ext}',
  },
  mac: {
    target: ['zip'],
    category: 'public.app-category.developer-tools',
    identity: '-',
    hardenedRuntime: false,
    gatekeeperAssess: false,
    notarize: false,
    signIgnore: ['/engine/studio-engine\\.node$'],
    artifactName: 'Grok-Workbench-${version}-macOS-${arch}-UNTESTED.zip',
  },
  afterPack: async (context) => {
    if (context.electronPlatformName !== 'darwin') return;
    const resources = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents/Resources',
    );
    const engine = path.join(resources, 'engine/studio-engine.node');
    // Sign the addon before sealing metadata, then exclude it from later re-signing.
    cp.execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', engine], {
      stdio: 'inherit',
    });
    const file = path.join(resources, 'engine/notices/engine.json');
    const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
    metadata.sha256 = crypto.createHash('sha256').update(fs.readFileSync(engine)).digest('hex');
    fs.writeFileSync(file, JSON.stringify(metadata, null, 2) + '\n');
  },
};
