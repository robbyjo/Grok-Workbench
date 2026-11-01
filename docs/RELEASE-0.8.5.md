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

## Publication record

[Published release](https://github.com/robbyjo/Grok-Workbench/releases/tag/v0.8.5), source `626a93a30818d1c66d8a65ee9a95375d44a32ca7`. Successful builds: [Windows](https://github.com/robbyjo/Grok-Workbench/actions/runs/41274679777), [Linux](https://github.com/robbyjo/Grok-Workbench/actions/runs/41274679751) and [both Mac architectures](https://github.com/robbyjo/Grok-Workbench/actions/runs/41274680825). The [publisher](https://github.com/robbyjo/Grok-Workbench/actions/runs/41277647210) verified all exact CI artifacts before publication. Independent unauthenticated downloads verified all 18 public assets and all five package checksums; v0.8.4 remains unchanged. See [the complete validation record](VALIDATION.md).

| Package                                                                                                                                                                     |       Bytes | SHA-256                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------: | ------------------------------------------------------------------ |
| [Grok-Workbench-0.8.5-Portable.exe](https://github.com/robbyjo/Grok-Workbench/releases/download/v0.8.5/Grok-Workbench-0.8.5-Portable.exe)                                   | 147,019,550 | `9e3f5ed2cfc57685d52105c76f82501cda0fe376a0b3208f6d905d5bfcb895ed` |
| [Grok-Workbench-0.8.5-linux-amd64-EXPERIMENTAL.deb](https://github.com/robbyjo/Grok-Workbench/releases/download/v0.8.5/Grok-Workbench-0.8.5-linux-amd64-EXPERIMENTAL.deb)   | 163,750,136 | `28ed4a3903b33ae1ad9ce7af4d4869376f33c7fa7ecff2b7becd4bf8f5254a19` |
| [Grok-Workbench-0.8.5-linux-x64-EXPERIMENTAL.tar.gz](https://github.com/robbyjo/Grok-Workbench/releases/download/v0.8.5/Grok-Workbench-0.8.5-linux-x64-EXPERIMENTAL.tar.gz) | 206,541,836 | `ee0b1ecdac40fa8fca7b2fb261065329e3b9f8142371790aa6213addaab979bf` |
| [Grok-Workbench-0.8.5-macOS-arm64-UNTESTED.zip](https://github.com/robbyjo/Grok-Workbench/releases/download/v0.8.5/Grok-Workbench-0.8.5-macOS-arm64-UNTESTED.zip)           | 208,271,956 | `8d45640d302549cd81f6ee9aece893dd2db22276979b0b304de1bb9d94f35574` |
| [Grok-Workbench-0.8.5-macOS-x64-UNTESTED.zip](https://github.com/robbyjo/Grok-Workbench/releases/download/v0.8.5/Grok-Workbench-0.8.5-macOS-x64-UNTESTED.zip)               | 220,135,930 | `078de20fb7a782e37a76414540a497367e4e226261aa77b8bd73ceacac327399` |
