# Grok Workbench 0.8.1 (alpha)

Windows 10/11 x64 portable. Unsigned; Windows may show SmartScreen warnings.

- **Larger text:** Settings → Appearance offers UI text scaling from 100–175% and an independent 12–24 px font size for chat/log output and terminals. UI scaling also enlarges editor text.
- **Light or dark:** choose the background theme in Appearance. Open terminals and editors update immediately when you save. Appearance settings survive restart.
- **Remembered approvals:** fixed “Yes, and don't ask again for anything” approving only the current action. Workbench now sends the engine's mode-change notification and remembers the choice for that chat across reconnects and restarts. Use **Ask for approvals again** to turn prompting back on. Allow-once, tool-specific grants, project trust and engine-enforced restrictions keep their separate scopes.

For a manual upgrade, close Workbench, replace the executable, and retain the adjacent **Grok Desktop Data** folder. The profile location, desktop/history schema and pinned native storage contract are unchanged. Workbench's reviewed updater may request an explicit compatible-engine backup if the native binary hash changes. Upgrades from 0.7.0 or earlier require manual executable replacement.

If you selected the broken “don't ask again for anything” option in 0.8.0, select it once more after upgrading to record the chat preference; the old Workbench did not record that mode choice.

Publication uses the exact successful Windows CI artifact after backend, source/packaged GUI, portable launch/relocation and replacement/restart/rollback acceptance. The repeated-approval fix has protocol-fixture coverage; no live model/tool approval run is claimed. See [validation](VALIDATION.md) and [remaining release gates](RELEASE-GATES.md).
