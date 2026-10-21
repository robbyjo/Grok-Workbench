# Grok Workbench 0.8.3 (alpha)

Windows 10/11 x64 portable. Unsigned; Windows may show SmartScreen warnings.

- **Clearer Updates layout:** Current installation, Find updates and Installation options are separate groups. Checkboxes have their own rows, guidance wraps below the options, and buttons have visible boundaries and spacing. Installation diagnostics wrap within the panel. Light/dark themes and enlarged UI text remain supported.
- **Preference-save feedback:** Desktop preferences show progress while saving, disable duplicate saves and field changes until completion, and clear stale feedback before another attempt. Success appears only after the write completes; errors remain visible.
- **Storage regression reliability:** The test waits for the actual save to complete, checks the persisted budget, and retains coverage for quota refusal, canceled pruning, verified export/prune, restore, overwrite refusal and installed-version inspection. Storage and Updates layout regressions run before native compilation in Windows CI as well as in full source and packaged acceptance.

Close Workbench before a manual upgrade, replace the executable and retain the adjacent **Grok Desktop Data** folder. The desktop/history schemas, binding ABI and pinned native storage contract are unchanged. The reviewed updater may require a compatible-engine backup if its binary hash changes. Upgrades from 0.7.0 or earlier require manual executable replacement.

Publication uses the exact successful Windows CI artifact after backend, source/packaged GUI, portable launch/relocation and replacement/restart/rollback acceptance. See [validation](VALIDATION.md) and [remaining release gates](RELEASE-GATES.md). This maintenance release does not claim new live model/provider acceptance.

[v0.8.3 is published](https://github.com/robbyjo/Grok-Workbench/releases/tag/v0.8.3) as GitHub Latest from [Windows CI run 39533983946](https://github.com/robbyjo/Grok-Workbench/actions/runs/39533983946). All 11 source and 11 packaged GUI scenarios passed, including storage and enlarged-font Updates acceptance. Public executable/checksum/manifest downloads match the tested CI artifact; the executable SHA-256 is `c2eecc6f322fbc49e8bb9cead3a879ec35d9c4ae2922915f4bd65d155665d83f`.
