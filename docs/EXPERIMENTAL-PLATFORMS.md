# Experimental Linux and macOS packages

Version 0.8.5 merges the platform branch with the current main application,
including provider profiles, schedules/PR watches, paired remote access,
document previews and personalization/localization. Every release package is
published from a successful CI run at the same public source commit. Package
manifests and `RELEASE-PROVENANCE.json` record that source and native checksums.

The embedded source stays at Grok Build 1.0.45, revision
`2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`, binding 0.6.0 and the existing
Cargo.lock. This work does not switch to CLI 1.0.70.

## Availability and validation

Linux x64 packages are built on hosted Ubuntu 24.04 using the
[Linux workflow](../.github/workflows/experimental-linux.yml). macOS Intel and Apple
Silicon packages are built on separate GitHub-hosted macOS runners using the
[experimental workflow](../.github/workflows/experimental-macos.yml).
**Both macOS packages are UNTESTED until a volunteer validates them on real
hardware.** Compilation, native protocol fixtures, and signature verification
do not establish normal desktop, account, or agent behavior.

The published 0.8.5 release extends native fixture acceptance to provider routing,
schedules, paired remote HTTP controls and secure key storage. Remembered
provider keys use the same Linux keyring protection as xAI keys; `basic_text`
and unknown backends are refused. Linux acceptance exercises the source app
and actual extracted Debian/archive payloads with Chromium sandboxing enabled.
Mac desktop behavior stays UNTESTED. Publication requires accepted Windows,
Linux and both Mac artifacts at the same source revision; the completed
release record is kept in [VALIDATION.md](VALIDATION.md).

### Initial 0.8.4 platform qualification (historical)

The records below describe the initial snapshot at
`51c67342b98dfe732c193765aa191dd1061a10a4` plus platform work and the MCP fix.
That first snapshot excluded the then-separate provider/remote/automation
changes. Version 0.8.5 includes those changes and receives fresh CI artifacts.

Linux's cold native build completed in 16 minutes 30 seconds. Its 31 selected
protocol, workflow, workspace and compressed-MCP regressions passed. Two added
POSIX storage regressions reproduce and repair Chromium's live profile-lock
link conflict while retaining rejection of other linked paths. The standalone
GUI fixture exercises file editing/external refresh, a real Git commit, POSIX
PTY output, session-only credentials, embedded MCP STDIO discovery, backend
platform guards, and persistence across normal shutdown/reopen. Chromium
sandboxing is explicitly enabled in the harness and checked in the main process.

The final Linux packages use source
`4959fbbc781648712c3a54afba6e3bb732e3091f`. Both the actual Debian package and
tar.gz archive were extracted and passed all eight desktop-fixture groups,
including embedded MCP discovery and normal shutdown/reopen, with Chromium
sandboxing enabled. The downloaded files matched their SHA-256 sidecars and
manifests independently. The Debian package is 163,091,256 bytes; the archive is
205,331,787 bytes. Native engine SHA-256:
`9e9f2d34fc8f3f03d7b1490e233f4261fe8db0de6666b9d84a6b221d1913c1e7`.
Six profile-storage tests passed on Linux, with the Windows-only lock test
skipped. No live sign-in or model request was tested. Headless fixtures do not
establish real desktop integration, system installation or provider acceptance.

The final [macOS CI run](https://github.com/robbyjo/Grok-Workbench/actions/runs/41260544325)
passed for both Intel and Apple Silicon at the same source commit. Each target
passed 28 protocol/profile/native MCP tests, with one Windows-only test skipped.
The packager verified the final app's ad-hoc signature with
`codesign --verify --deep --strict`. Both downloaded CI archive digests, package
checksums, signed engine checksums and actual Mach-O CPU types were independently
verified. The Apple Silicon ZIP is 206,992,367 bytes; Intel is 218,858,191 bytes.
Both bundles declare macOS 13.0 as their minimum version; compatibility and
desktop behavior remain **UNTESTED pending volunteer validation**.

The first hosted native compilations took 49m 52s on Apple Silicon and 72m 10s
on Intel. The final cached compilations took 1m 19s and 4m 06s respectively.
These are build-runner timings, not application startup requirements.

## Platform boundaries

Default application data lives in `~/.config/grok-desktop` on Linux (or the
configured XDG application-data directory) and
`~/Library/Application Support/grok-desktop` on macOS. The private native Grok
profile lives in its `grok` subdirectory. `GROK_DESKTOP_DATA_DIR` and `GROK_HOME`
can override these paths. Preserve the application data when updating packages.

- Updates are manual. The Windows portable replacement/rollback worker is not
  included or exposed on Linux/macOS.
- Native session pruning/restoration is rejected by the backend until
  POSIX lock behavior receives its own acceptance. The Windows locking helper
  cannot provide that guarantee on another OS.
- Windows Sandbox preparation is available only on Windows.
- Terminals and default project actions use the host shell. Existing saved
  PowerShell project actions must be edited for a POSIX machine.
- Remembered API keys require an available system keyring. Linux's `basic_text`
  fallback is refused for remembered keys. Session-only keys and fresh OAuth
  sign-in are alternatives. No personal credentials are included in packages.
- Normal agent tools, terminals, hooks and project actions retain the current
  user's permissions. This port does not certify OS-level agent isolation or
  complete descendant-process cleanup.
- These are native builds for each target OS and architecture. Cross-compiling
  the Rust addon alone would not validate Electron packaging, native PTY
  dependencies, OS credential storage, or macOS code signatures.

## Build on the target platform

Use Node.js 24+, npm, Git, Rust 1.95.0 and the platform's native build tools.
macOS needs the Xcode command-line tools. Linux needs a C/C++ toolchain, CMake,
Clang, pkg-config, OpenSSL/zlib development headers, unzip and Electron's GTK,
NSS, ATK, CUPS, DRM, X11, GBM and ALSA runtime libraries. Xvfb, D-Bus and xauth
are needed only for headless GUI acceptance. Building on Ubuntu 24.04 does not
establish compatibility with older glibc versions or every Linux distribution.

```sh
npm ci
node node_modules/electron/install.js
npm run build
npm run engine:build
npx tsx --test tests/agent.test.ts tests/mcp-compression.test.ts
npm run licenses
node scripts/package-experimental.cjs
```

The build selects a checksum-pinned protobuf compiler for the native host.
`PROTOC` can select an existing compiler. The experimental packager includes
the native addon and dependency notices, omits Windows runtime files, verifies
the packaged engine checksum, and writes `.sha256` / `.manifest.json` sidecars.
Linux emits Debian packages and tar.gz archives. macOS emits separate x64/arm64 ZIPs.
The build tool's AppImage launcher can silently add `--no-sandbox` when user
namespaces are restricted, so AppImage is excluded from these outputs. The
Debian desktop launcher and archive executable retain normal Chromium sandbox
startup behavior.

The Debian installation directory is `/opt/Grok-Workbench`, while the menu and
window title remain "Grok Workbench". This avoids a reproduced Chromium setuid
helper failure when its executable path contains spaces. Extract the archive
under a path without spaces when using that helper. The Debian package is the
preferred Ubuntu format; archive launch still requires a working host sandbox.

On the Ubuntu build host, global AppArmor policy restricts unprivileged user
namespaces. Headless tests configure only the extracted Electron `chrome-sandbox`
helper with its standard root ownership / mode 4755. They do not disable the
Chromium sandbox or change global AppArmor/sysctl policy. Normal Debian
installation includes electron-builder's package-specific AppArmor setup;
system installation and real desktop integration remain volunteer checks.

The Linux-only desktop fixture uses a temporary project and profile and makes
no model requests. On a headless build host with a working Chromium sandbox:

```sh
dbus-run-session -- xvfb-run -a node scripts/linux-platform-smoke.mjs
GROK_DESKTOP_TEST_EXE="$PWD/release/linux-unpacked/grok-workbench" \
  dbus-run-session -- xvfb-run -a node scripts/linux-platform-smoke.mjs
```

macOS builds use ad-hoc code signatures to support development loading, with
the addon checksum recorded after signing. They have **no trusted Apple
Developer ID signature or notarization**. Ad-hoc signing establishes package
integrity, not publisher trust. No Apple signing account is configured here.

## Volunteer validation

For macOS, first report OS version, Intel/Apple Silicon, package checksum and
whether the app can launch through normal system policy. Then test fresh local
sign-in, a real chat, cancellation, tool approvals, reconnect/resume after a full
restart, file save/conflict handling, Git, terminal tabs, paste/drop attachments,
and an MCP server. Check clipboard/menu/keyboard behavior and closing the app
with active work. Report sanitized errors; never send tokens or API keys.

Linux volunteers should also report desktop session (X11/Wayland), distribution,
keyring availability and which package format they tested. A headless Xvfb
check cannot establish real desktop integration or model-provider acceptance.
