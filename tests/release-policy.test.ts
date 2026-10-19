import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { validateRun, validateDraftRelease } = createRequire(import.meta.url)(
  '../scripts/publish-ci-release.cjs',
);
test('release publication rejects unsuccessful, stale, fork/PR and unrelated workflow builds', () => {
  const head = 'a'.repeat(40),
    run = {
      head_sha: head,
      head_branch: 'main',
      event: 'push',
      conclusion: 'success',
      status: 'completed',
      path: '.github/workflows/windows.yml',
      repository: { full_name: 'robbyjo/Grok-Workbench' },
    };
  validateRun(run, head);
  for (const invalid of [
    { conclusion: 'failure' },
    { status: 'in_progress' },
    { head_sha: 'b'.repeat(40) },
    { event: 'pull_request' },
    { head_branch: 'other' },
    { path: '.github/workflows/release.yml' },
    { repository: { full_name: 'someone/fork' } },
  ])
    assert.throws(() => validateRun({ ...run, ...invalid }, head), /trusted Windows run/);
});

test('draft lookup binds its numeric release ID to the exact reserved tag and tested source', () => {
  const head = 'a'.repeat(40);
  const draft = { id: 42, tag_name: 'v0.8.0', target_commitish: head, draft: true };
  assert.equal(validateDraftRelease(draft, 'v0.8.0', head), 42);
  for (const invalid of [
    { id: undefined },
    { id: '42' },
    { id: 0 },
    { id: 1.5 },
    { tag_name: 'v0.7.0' },
    { target_commitish: 'b'.repeat(40) },
    { target_commitish: 'main' },
    { draft: false },
  ])
    assert.throws(
      () => validateDraftRelease({ ...draft, ...invalid }, 'v0.8.0', head),
      /draft release identity/,
    );
});
