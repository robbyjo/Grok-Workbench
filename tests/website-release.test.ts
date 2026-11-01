import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { websiteRelease, releaseReady } = createRequire(import.meta.url)(
  '../scripts/website-release-ready.cjs',
);
test('website deployment waits for all advertised public platform downloads', () => {
  const html = readFileSync('website/index.html', 'utf8');
  const website = websiteRelease(html);
  const release = {
    tag_name: website.tag,
    draft: false,
    assets: website.assets.map((name: string) => ({ name, state: 'uploaded', size: 1 })),
  };
  assert.equal(releaseReady(release, website), true);
  assert.equal(releaseReady({ ...release, draft: true }, website), false);
  assert.equal(releaseReady({ ...release, assets: release.assets.slice(1) }, website), false);
  assert.equal(releaseReady({ ...release, tag_name: 'v0.0.0' }, website), false);
  assert.throws(
    () =>
      websiteRelease(html.replace('releases/download/' + website.tag, 'releases/download/v0.0.0')),
    /mixes release/,
  );
  assert.throws(
    () => websiteRelease(html.replace(/grok-workbench-version/g, 'missing-version')),
    /version is missing/,
  );
});
