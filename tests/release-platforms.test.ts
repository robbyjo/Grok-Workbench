import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { validateRun, validateManifest, revision } = createRequire(import.meta.url)(
  '../scripts/release-platforms.cjs',
);
test('platform publication accepts only successful owner workflows at the exact release source', () => {
  const head = 'a'.repeat(40);
  for (const platform of ['linux', 'macos']) {
    const run = {
      head_sha: head,
      head_branch: platform === 'macos' ? 'codex/linux-macos-builds' : 'main',
      event: 'push',
      conclusion: 'success',
      status: 'completed',
      path: `.github/workflows/experimental-${platform}.yml`,
      repository: { full_name: 'robbyjo/Grok-Workbench' },
    };
    validateRun(run, head, platform);
    for (const change of [
      { head_sha: 'b'.repeat(40) },
      { head_branch: 'other' },
      { event: 'pull_request' },
      { status: 'in_progress' },
      { conclusion: 'failure' },
      { path: '.github/workflows/windows.yml' },
      { repository: { full_name: 'other/fork' } },
    ])
      assert.throws(() => validateRun({ ...run, ...change }, head, platform), /trusted/);
  }
});
test('experimental publication refuses stale metadata, wrong CPUs, engine changes and missing Mac UNTESTED status', () => {
  const expected = {
    version: '0.8.5',
    head: 'a'.repeat(40),
    platform: 'darwin-arm64',
    sha256: 'b'.repeat(64),
    bytes: 42,
  };
  const manifest = {
    format: 1,
    product: 'Grok Workbench',
    version: expected.version,
    source: expected.head,
    platform: expected.platform,
    sha256: expected.sha256,
    bytes: expected.bytes,
    nativeRevision: revision,
    bindingVersion: '0.6.0',
    engineSha256: 'c'.repeat(64),
    experimental: true,
    volunteerTested: false,
    updates: 'manual only',
    macOSStatus: 'UNTESTED - volunteer validation required',
  };
  validateManifest(manifest, expected);
  for (const change of [
    { source: 'd'.repeat(40) },
    { version: '0.8.4' },
    { platform: 'darwin-x64' },
    { sha256: 'e'.repeat(64) },
    { bytes: 41 },
    { nativeRevision: 'f'.repeat(40) },
    { bindingVersion: '1.0.0' },
    { engineSha256: '' },
    { volunteerTested: true },
    { experimental: false },
    { updates: 'automatic' },
    { macOSStatus: 'tested' },
  ])
    assert.throws(() => validateManifest({ ...manifest, ...change }, expected), /contract/);
});
