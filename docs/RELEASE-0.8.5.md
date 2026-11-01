# Grok Workbench 0.8.5 alpha

This release merges the extended app and platform branches. Grok Build remains
at public source 1.0.45, revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`,
binding 0.6.0 and the pinned storage contract. The MCP transport enables gzip,
Brotli, deflate and Zstandard decoding without switching to CLI 1.0.70.

## Application changes

- Provider profiles use the native engine's model/endpoint routing and keep keys
  outside TOML. Linux remembered secrets require a real system keyring;
  session-only keys remain available. A portable failing credential helper
  prevents fallback to an unrelated xAI key outside Workbench.
- Local schedules, durable run records, PR watches/optional continuation and
  manually paired loopback mobile/REST access are included.
- Local PDF, Office, Markdown/media and isolated browser previews join the file
  workspace. Navigation/common controls offer six languages and more appearance
  preferences. See [extended setup and limits](EXTENDED-WORKBENCH.md).

## Downloads and validation scope

Windows 10/11 x64 retains the unsigned portable executable, profile preservation,
source/packaged GUI acceptance and actual relocation/replacement/restart/rollback
checks. The adjacent `Grok Desktop Data` folder must be retained during updates.

Linux x64 adds experimental Ubuntu 24.04 `.deb` and `.tar.gz` packages. The source
and both actual extracted payloads receive headless desktop checks with Chromium
sandboxing enabled. Other distributions, system installation and real desktop
integration need separate volunteer acceptance.

**macOS Apple Silicon and Intel are UNTESTED until volunteer desktop validation.**
The ZIPs declare macOS 13.0 minimum. Native protocol/provider fixtures, package
checksums and ad-hoc code-signature verification are automated; they do not
establish interactive desktop behavior. There is no Apple Developer ID signature
or notarization, so macOS may block launch.

Linux/macOS updates are manual. Native session pruning/restoration and Windows
Sandbox preparation are unavailable there. Agent OS containment, real provider
accounts/tunnels, physical devices, full accessibility, reboot/token-expiry and
other [release gates](RELEASE-GATES.md) remain separate from local fixture checks.

The publication workflow accepts only trusted successful runs at one public
main commit, verifies package bytes and embedded Linux/Mac engine CPU/hash,
creates a draft, checks every uploaded asset digest and then publishes. Individual
sidecars, `SHA256SUMS.txt` and `RELEASE-PROVENANCE.json` accompany all downloads.
The website waits until every advertised download is public before deploying.
