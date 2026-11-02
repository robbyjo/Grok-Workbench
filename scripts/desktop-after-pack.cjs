// extraResources can be Authenticode-signed during copying. Seal the final bytes.
const { join } = require('node:path');
const { readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
module.exports = async (context) => {
  if (context.electronPlatformName !== 'win32') return;
  const root = join(context.appOutDir, 'resources');
  const file = join(root, 'desktop-control.json');
  const metadata = JSON.parse(readFileSync(file, 'utf8'));
  metadata.sha256 = createHash('sha256')
    .update(readFileSync(join(root, 'desktop-control.exe')))
    .digest('hex');
  writeFileSync(file, JSON.stringify(metadata, null, 2) + '\n');
};
