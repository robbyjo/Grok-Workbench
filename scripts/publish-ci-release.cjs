// Manual CI-only publication: immutable source/artifact identity, draft until all assets verify.
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const repository = 'robbyjo/Grok-Workbench';
const { validateRun, collectExperimental, fileHash, revision } = require('./release-platforms.cjs');
const gh = (...args) =>
  cp.execFileSync('gh', args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const api = (endpoint) => JSON.parse(gh('api', endpoint));
function validateDraftRelease(release, tag, head) {
  if (
    !Number.isSafeInteger(release.id) ||
    release.id <= 0 ||
    release.tag_name !== tag ||
    release.target_commitish !== head ||
    release.draft !== true
  )
    throw new Error('Unexpected draft release identity.');
  return release.id;
}
async function main() {
  const runId = process.env.GROK_RELEASE_RUN_ID,
    linuxRunId = process.env.GROK_RELEASE_LINUX_RUN_ID,
    macosRunId = process.env.GROK_RELEASE_MACOS_RUN_ID,
    head = process.env.GROK_RELEASE_HEAD,
    signed = process.env.GROK_RELEASE_SIGNED === 'true';
  if (!/^\d+$/.test(runId ?? '')) throw new Error('Invalid Windows workflow run ID.');
  if (!/^\d+$/.test(linuxRunId ?? '') || !/^\d+$/.test(macosRunId ?? ''))
    throw new Error('Linux and macOS workflow run IDs are required.');
  validateRun(api(`repos/${repository}/actions/runs/${runId}`), head);
  validateRun(api(`repos/${repository}/actions/runs/${linuxRunId}`), head, 'linux');
  validateRun(api(`repos/${repository}/actions/runs/${macosRunId}`), head, 'macos');
  if (api(`repos/${repository}/git/ref/heads/main`).object?.sha !== head)
    throw new Error('Main changed since the accepted release build.');
  const source = api(`repos/${repository}/contents/package.json?ref=${head}`),
    version = JSON.parse(Buffer.from(source.content, 'base64').toString()).version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid source version.');
  const tag = 'v' + version,
    artifacts = api(`repos/${repository}/actions/runs/${runId}/artifacts`).artifacts;
  const name = `Grok-Workbench-${signed ? 'Signed-' : ''}Windows-x64-${head}`;
  if (artifacts.filter((a) => a.name === name && !a.expired).length !== 1)
    throw new Error('Exact tested artifact is unavailable.');
  // Never replace an existing release or a previously created tag.
  if (
    api(`repos/${repository}/git/matching-refs/tags/${tag}`).some(
      (ref) => ref.ref === 'refs/tags/' + tag,
    )
  )
    throw new Error('Version tag already exists. Choose a new version.');
  const directory = fs.mkdtempSync(path.join(process.cwd(), 'ci-release-'));
  gh('run', 'download', runId, '--repo', repository, '--name', name, '--dir', directory);
  const exeName = `Grok-Workbench-${version}-Portable.exe`,
    exe = path.join(directory, exeName),
    manifestPath = exe + '.manifest.json',
    checksumPath = exe + '.sha256';
  if (
    fs.readdirSync(directory).sort().join('|') !==
    [exeName, exeName + '.manifest.json', exeName + '.sha256'].sort().join('|')
  )
    throw new Error('Unexpected release artifact contents.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
    hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(exe)) hash.update(chunk);
  const digest = hash.digest('hex');
  if (
    manifest.format !== 2 ||
    manifest.product !== 'Grok Workbench' ||
    manifest.version !== version ||
    manifest.platform !== 'win32-x64' ||
    manifest.nativeRevision !== revision ||
    manifest.bindingVersion !== '0.6.0' ||
    manifest.sha256 !== digest ||
    manifest.bytes !== fs.statSync(exe).size ||
    fs.readFileSync(checksumPath, 'utf8').trim() !== digest + '  ' + exeName
  )
    throw new Error('CI artifact checksums/version failed verification.');
  const inspect =
    "$ErrorActionPreference='Stop';Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1');$v=[Diagnostics.FileVersionInfo]::GetVersionInfo($env:GROK_RELEASE_EXE);$s=Get-AuthenticodeSignature -LiteralPath $env:GROK_RELEASE_EXE;@{version=(@($v.FileMajorPart,$v.FileMinorPart,$v.FileBuildPart)-join '.');product=$v.ProductName;signature=$s.Status.ToString();thumbprint=$s.SignerCertificate.Thumbprint;publisher=if($s.SignerCertificate){$s.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false)}else{''}}|ConvertTo-Json -Compress";
  const identity = JSON.parse(
    cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', inspect], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, GROK_RELEASE_EXE: exe },
    }),
  );
  if (identity.version !== version || identity.product !== 'Grok Workbench')
    throw new Error('Unexpected executable identity.');
  if (
    signed &&
    (!process.env.GROK_SIGNER_THUMBPRINT ||
      !process.env.GROK_SIGNER_NAME ||
      identity.signature !== 'Valid' ||
      identity.thumbprint?.toLowerCase() !== process.env.GROK_SIGNER_THUMBPRINT.toLowerCase() ||
      identity.publisher !== process.env.GROK_SIGNER_NAME ||
      manifest.signerThumbprint?.toLowerCase() !== identity.thumbprint.toLowerCase())
  )
    throw new Error('Approved signing identity failed verification.');
  if (!signed && (identity.signature !== 'NotSigned' || manifest.signerThumbprint))
    throw new Error('Unsigned release selection does not match artifact signature.');
  const experimental = await collectExperimental({
    root: directory,
    version,
    head,
    linuxRunId,
    macosRunId,
  });
  const packages = [
    {
      file: exeName,
      platform: 'win32-x64',
      bytes: manifest.bytes,
      sha256: digest,
      engineSha256: manifest.engineSha256,
      signature: identity.signature,
    },
    ...experimental.packages,
  ];
  const sums = path.join(directory, 'SHA256SUMS.txt'),
    provenance = path.join(directory, 'RELEASE-PROVENANCE.json');
  fs.writeFileSync(sums, packages.map((item) => item.sha256 + '  ' + item.file).join('\n') + '\n');
  fs.writeFileSync(
    provenance,
    JSON.stringify(
      {
        format: 1,
        product: 'Grok Workbench',
        version,
        source: head,
        nativeRevision: revision,
        workflows: { windows: runId, linux: linuxRunId, macos: macosRunId },
        packages,
        macOSStatus: 'UNTESTED - volunteer desktop validation required',
      },
      null,
      2,
    ) + '\n',
  );
  const releaseFiles = [exe, manifestPath, checksumPath, ...experimental.assets, sums, provenance];
  const notes = path.join(directory, 'release-notes.md');
  fs.writeFileSync(
    notes,
    `Grok Workbench ${version} alpha brings the platform branches together with provider profiles, local document previews, scheduled tasks and PR watches, paired remote access, and appearance/localization improvements. The embedded engine remains Grok Build 1.0.45 with the tested MCP compression backport.\n\n- **Windows 10/11 x64:** portable executable. ${signed ? 'Signed using the approved code-signing policy.' : 'Unsigned; Windows may show SmartScreen warnings.'} Preserve the adjacent Grok Desktop Data folder when updating.\n- **Linux x64:** experimental Ubuntu 24.04 Debian package and tar.gz archive. Source and extracted-package headless desktop checks passed. Other distributions and real desktop integration need volunteer validation.\n- **macOS Apple Silicon and Intel: UNTESTED until volunteer desktop validation.** The ZIPs declare macOS 13.0 minimum and have ad-hoc signatures, without Apple Developer ID signing or notarization. macOS may block launch.\n\nLinux/macOS updates are manual. Native session pruning/restoration and Windows Sandbox preparation are unavailable there. Remembered keys require secure system storage; Linux basic_text fallback is refused.\n\nAll packages come from the same public source ${head}. Exact tested CI artifacts: [Windows](https://github.com/${repository}/actions/runs/${runId}), [Linux](https://github.com/${repository}/actions/runs/${linuxRunId}), [macOS](https://github.com/${repository}/actions/runs/${macosRunId}). SHA256SUMS.txt and RELEASE-PROVENANCE.json accompany per-package checksums/manifests.\n\nSee [platform notes](https://github.com/${repository}/blob/${head}/docs/EXPERIMENTAL-PLATFORMS.md) and [release gates](https://github.com/${repository}/blob/${head}/docs/RELEASE-GATES.md) for validation scope and volunteer checks. Remote access, external provider accounts, OS containment and Mac desktop behavior are not certified by local fixtures.\n`,
  );
  // Reserve the exact immutable target explicitly: a draft need not create its
  // Git ref until publication. POST refuses an existing ref rather than moving it.
  gh(
    'api',
    `repos/${repository}/git/refs`,
    '-X',
    'POST',
    '-f',
    `ref=refs/tags/${tag}`,
    '-f',
    `sha=${head}`,
  );
  const reserved = api(`repos/${repository}/git/ref/tags/${tag}`);
  if (reserved.object?.type !== 'commit' || reserved.object.sha !== head)
    throw new Error('Reserved version tag does not match the tested source.');
  gh(
    'release',
    'create',
    tag,
    ...releaseFiles,
    '--repo',
    repository,
    '--target',
    head,
    '--verify-tag',
    '--title',
    `Grok Workbench ${version} (alpha)`,
    '--draft',
    '--prerelease',
    '--notes-file',
    notes,
  );
  // GitHub's tag endpoint can return 404 for a draft. The CLI resolves drafts
  // through its authenticated listing fallback; bind all later reads to its ID.
  const draftId = JSON.parse(
    gh('release', 'view', tag, '--repo', repository, '--json', 'databaseId'),
  ).databaseId;
  if (!Number.isSafeInteger(draftId) || draftId <= 0) throw new Error('Invalid draft release ID.');
  const release = api(`repos/${repository}/releases/${draftId}`);
  validateDraftRelease(release, tag, head);
  const tagged = api(`repos/${repository}/git/ref/tags/${tag}`);
  if (tagged.object?.type !== 'commit' || tagged.object.sha !== head)
    throw new Error('Release tag does not match the tested source. Release remains draft.');
  if (release.assets.length !== releaseFiles.length)
    throw new Error('Unexpected draft release assets.');
  for (const file of releaseFiles) {
    const local = await fileHash(file),
      asset = release.assets.find((a) => a.name === path.basename(file));
    if (!asset || asset.digest !== 'sha256:' + local || asset.size !== fs.statSync(file).size)
      throw new Error('Uploaded asset verification failed. Release remains draft for repair.');
  }
  if (api(`repos/${repository}/git/ref/heads/main`).object?.sha !== head)
    throw new Error('Main changed during release preparation. Verified release remains draft.');
  gh(
    'api',
    `repos/${repository}/releases/${draftId}`,
    '-X',
    'PATCH',
    '-F',
    'draft=false',
    '-F',
    'prerelease=false',
    '-f',
    'make_latest=true',
  );
  let published;
  for (let attempt = 0; attempt < 10; attempt++) {
    published = api(`repos/${repository}/releases/${draftId}`);
    if (
      !published.draft &&
      !published.prerelease &&
      api(`repos/${repository}/releases/latest`).id === draftId
    )
      break;
    if (attempt === 9) throw new Error('Publication/Latest status was not confirmed.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log(published.html_url);
}
module.exports = { validateRun, validateDraftRelease };
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
