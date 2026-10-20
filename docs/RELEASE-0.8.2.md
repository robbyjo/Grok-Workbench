# Grok Workbench 0.8.2 (alpha)

Windows 10/11 x64 portable. Unsigned; Windows may show SmartScreen warnings.

- **Permission selector:** below the message box, choose **Always ask**, **Approve for me** (Grok's Auto classifier), or **Approve all** for the current chat. The same selector is available in Settings. The choice survives reconnects and restarts. Change modes while the chat is idle.
- **New-chat defaults:** Settings → Models & permissions lets you save any of the three modes as the default for newly created chats. Existing chats retain their own choice; changing one chat leaves the default unchanged.
- **Live permission changes:** corrected the ACP extension method prefix required for the mode-change message to reach Grok. This also fixes switching immediately after choosing “don't ask again for anything”. Existing saved always-approve choices are reapplied on reconnect.
- **Organized Settings:** category tabs separate General, Appearance, Models & permissions, Account, Integrations, Configuration, Projects & sessions, Keyboard shortcuts, Storage & diagnostics, and Updates. Arrow keys, Home and End navigate categories. Switching tabs preserves drafts and the unsaved-configuration close guard.
- **Model and reasoning controls:** saved selectors remain usable after interrupted turns, reconnect before applying changes, and explain when an active turn temporarily disables them. Available choices still come from the selected engine/account and model configuration.
- **Layout and feedback:** category navigation scales with enlarged fonts, worktree controls retain distinct identities, permission saves wait for completion before reporting success, and the Settings footer displays the application version.

**Always ask** follows Grok's permission rules, so tools already allowed by those rules may run without another prompt. **Approve for me** requires native Auto mode to be enabled and may still ask about risky actions. **Approve all** retains project trust, deny rules, hooks and managed restrictions. Workbench does not answer pending approval/trust requests on the classifier's behalf.

For a manual upgrade, close Workbench, replace the executable, and retain the adjacent **Grok Desktop Data** folder. The profile location, desktop/history schema and pinned native storage contract are unchanged. Workbench's reviewed updater may request a compatible-engine backup if the native binary hash changes. Upgrades from 0.7.0 or earlier require manual executable replacement.

Publication uses the exact successful Windows CI artifact after backend, source/packaged GUI, portable launch/relocation and replacement/restart/rollback acceptance. Permission behavior has protocol-fixture and GUI coverage; this release does not claim a new live model/tool approval or native-classifier acceptance run. See [validation](VALIDATION.md) and [remaining release gates](RELEASE-GATES.md).
