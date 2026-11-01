const fs = require('node:fs');
const repository = 'robbyjo/Grok-Workbench';

function websiteRelease(html) {
  const version = html.match(/name="grok-workbench-version"\s+content="(\d+\.\d+\.\d+)"/)?.[1];
  if (!version) throw new Error('Website release version is missing.');
  const links = [
    ...html.matchAll(
      /https:\/\/github\.com\/robbyjo\/Grok-Workbench\/releases\/download\/(v[^/"\s]+)\/([^"\s<>]+)/g,
    ),
  ];
  if (!links.length || links.some(([, tag]) => tag !== 'v' + version))
    throw new Error('Website mixes release versions.');
  const assets = [...new Set(links.map(([, , name]) => name))];
  const expected = [
    `Grok-Workbench-${version}-Portable.exe`,
    `Grok-Workbench-${version}-linux-amd64-EXPERIMENTAL.deb`,
    `Grok-Workbench-${version}-linux-x64-EXPERIMENTAL.tar.gz`,
    `Grok-Workbench-${version}-macOS-arm64-UNTESTED.zip`,
    `Grok-Workbench-${version}-macOS-x64-UNTESTED.zip`,
    'SHA256SUMS.txt',
  ];
  if (expected.some((name) => !assets.includes(name)))
    throw new Error('Website must link every platform package and checksums.');
  return { version, tag: 'v' + version, assets };
}
function releaseReady(release, website) {
  return (
    release?.tag_name === website.tag &&
    release.draft === false &&
    website.assets.every((name) =>
      release.assets?.some(
        (asset) => asset.name === name && asset.state === 'uploaded' && asset.size > 0,
      ),
    )
  );
}
async function main() {
  const website = websiteRelease(fs.readFileSync('website/index.html', 'utf8'));
  const response = await fetch(
    `https://api.github.com/repos/${repository}/releases/tags/${website.tag}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Grok-Workbench-website',
        ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok && response.status !== 404)
    throw new Error(`Release lookup returned ${response.status}.`);
  const ready = response.status !== 404 && releaseReady(await response.json(), website);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `ready=${ready}\n`);
  console.log(
    ready
      ? `Website downloads are public for ${website.tag}.`
      : `Keep the current website online until every ${website.tag} download is published.`,
  );
}
module.exports = { websiteRelease, releaseReady };
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
