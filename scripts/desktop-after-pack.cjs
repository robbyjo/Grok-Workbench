// extraResources can be Authenticode-signed during copying. Seal the final bytes.
const { join } = require('node:path');
const { readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
module.exports = async (context) => {
  if (context.electronPlatformName !== 'win32') return;
  const root = join(context.appOutDir, 'resources');
  for (const [name, extension] of [
    ['desktop-control', 'exe'],
    ['application-worker', 'exe'],
    ['document-worker', 'ps1'],
  ]) {
    const file = join(root, name + '.json');
    const metadata = JSON.parse(readFileSync(file, 'utf8'));
    metadata.sha256 = createHash('sha256')
      .update(readFileSync(join(root, name + '.' + extension)))
      .digest('hex');
    writeFileSync(file, JSON.stringify(metadata, null, 2) + '\n');
  }
};
