# Windows desktop control and prompt-driven read aloud

Development source after v0.8.5 includes both features on the **unchanged embedded Grok Build 1.0.45 source**, revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`, binding 0.6.0. They are Workbench-hosted MCP tools, not an undocumented xAI desktop API. The published v0.8.5 packages do not contain them yet.

## Windows window control

In a chat, expand **Desktop & read aloud**, choose **Refresh windows**, select a window, then **Enable for this chat**. Ask Grok to use its `workbench` desktop tools to perform a task there. Example: “In the selected window, enter the displayed code and press Verify. Inspect the result.”

The bridge captures only the selected window’s client area, returns a PNG and a bounded accessibility tree, and supports click, double-click, drag, literal Unicode typing, navigation/function keys, Ctrl/Shift/Alt application shortcuts, scrolling, UI Automation invoke and set-value. Drag accepts 2–128 screenshot points over 100–5,000 milliseconds, or a source/target accessibility reference from the same frame. Coordinates refer to the returned screenshot. Each action requires the matching view, expires after 30 seconds, consumes that view and requires a new observation before another action. At most 200 actions are allowed per grant. There is one grant across the app, scoped to its chat and the selected window’s handle, process ID, process start time and an opaque window property. A recycled window handle does not inherit the grant.

**Check desktop input** reports foreground/input-desktop availability without sending input. A connected RDP session must still expose an unlocked input desktop. Application shortcuts do not include Windows-key/window-switching or clipboard shortcuts. Separate opt-in [application workflows](APPLICATION-WORKFLOWS.md) add native Office, Blender, Krita and JMP operations, cart calculations and chess rule checking.

**Stop desktop** or **Ctrl+Alt+Escape** revokes access and terminates the helper. Canceling/disconnecting the chat, archiving/hiding it, switching engines, starting remote access, and quitting also revoke access. Queued operations cannot restore a revoked grant. Delivered input cannot be undone. Normal Grok MCP tool permissions still apply.

Windows must be unlocked. Mouse/keyboard operations require the selected window in the foreground and refuse points covered by another window. The helper runs without elevation; elevated, protected, secure-desktop and password-entry workflows are unsupported. Clipboard shortcuts are excluded. Capture uses Windows `PrintWindow`, with no whole-screen fallback: some GPU/protected applications may return blank or incomplete content. The model must stop or ask for help when it cannot see the target. Only one top-level window is granted; choose another window explicitly for separate dialogs. Arbitrary apps, multi-monitor DPI changes, long tasks and unattended operation remain unvalidated. Desktop control is disabled on Linux/macOS.

This is a capability grant to operate that window, not a filesystem or application sandbox. A capable application may expose files, network actions and other consequential operations within its own UI. Screen text is untrusted task data, not permission to change the user’s goal. The window title, screenshot and accessibility names are supplied to the selected chat model; do not grant a window containing unrelated sensitive information.

## Read text and documents aloud

Examples:

- “Read this aloud: Welcome to Grok Workbench.”
- “Read `report.pdf` aloud, pages 2 through 5, using voice Ara.”
- “Read `meeting-notes.docx` aloud without summarizing.”
- “Pause the reading.” / “Resume it.” / “Stop reading.”

Grok discovers `workbench.read_aloud`, `read_aloud_status` and `read_aloud_control` via the engine’s normal MCP discovery. The source is exactly one of `text`, `path` or `asset_id`. Workspace paths are canonicalized and reject traversal, links, hardlinks and private configuration folders. Attachments use the existing private Media store. The panel also offers a manual source picker.

Text/Markdown and Word **DOCX** use deterministic extraction; PDF uses bundled PDF.js in the sandboxed renderer. The model does not need to rewrite or reconstruct the document. Paragraph/table order is retained for DOCX. PDF reading order follows its text layer and may be imperfect for complex columns; images, charts, comments, headers/footers, tracked-change semantics and formatting are not spoken as rendered. Scanned PDFs need OCR. Password-protected PDFs need an unlocked copy. Convert old binary **.doc** files to **.docx** first.

Limits: 20 MiB per document, 100 PDF pages per request, 120,000 extracted characters, one active speech job and approximately 4,000 characters per audio segment. Truncated DOCX extraction is rejected instead of silently reading a partial document. Blank/binary/unsupported content and invalid page ranges return clear errors. PDF extraction has a 25-second worker deadline and 30-second broker deadline. Existing aggregate profile and 256 MiB/1,000-file Media budgets apply.

The existing English xAI speech endpoint uses voices **Eve, Ara, Leo, Rex, Sal** and the global Grok/xAI account, even when the coding chat selects another provider. Extracted text is sent to xAI for speech generation. No engine/library migration or account privacy setting change is needed. Service access and billing follow the account’s existing terms.

Audio plays in sequence as segments become available. The latest reading stays visible below the chat toolbar; older readings are collapsible. Use native audio controls to seek/change volume, job controls to pause/resume generation and playback, and **Stop reading** to cancel speech without canceling the chat. Pause takes effect between in-flight service calls; stop terminates the separate speech helper. A follow-up chat prompt can invoke speech controls while generation continues. If autoplay is blocked, press Play. Switching chats unmounts that chat’s player. Each segment can be exported and all generated assets remain in **Media** until explicitly deleted. Job controls are runtime-only and reset when the app restarts; saved audio remains.

## Build and validation

Windows development/package builds compile authored desktop-control and application-worker C# helpers using the system .NET Framework compiler. No Grok native binding changes are required. The application workflow suite adds pinned chess.js for chess rules. `engine:build` includes the helpers for Windows; experimental Linux/macOS packaging excludes them. The host verifies each helper's SHA-256 against its packaged manifest before launching it.

The Windows `afterPack` hook seals the copied helper bytes, including any Authenticode signature applied by Electron Builder’s resource transformer. Signed packaging itself remains unvalidated until signing credentials are configured.

```powershell
npm run desktop:build
npm run test:assist                 # owned native window + renderer extraction, no model inference
npx tsx scripts/assist-acceptance.ts --run --home 'ABSOLUTE\AUTHENTICATED\GROK\PROFILE'
```

The live command copies only `auth.json` into an isolated test profile, uses disposable content, runs bounded billable Grok/TTS requests and removes its temporary authentication/config home after shutdown. It never closes the user’s existing Workbench or edits the source authentication profile. It requires an unlocked desktop. Reports and screenshots are stored under `.test-data/assist-*`.

Pass `--speech-only` to test narration independently when Windows input is unavailable. This does not count as a desktop-input pass.

On November 2, 2026, the native bridge passed capture, real Windows click/Unicode input, changed-layout verification, cross-chat rejection, stale-frame rejection and revocation. **Grok 4.7** completed the same task using production MCP/IPC and the native Windows helper. Prompt-driven pasted text, TXT, PDF and DOCX each produced a valid MP3 decoded by the app. These short English samples do not establish pronunciation accuracy, complex-document reading order, every voice, arbitrary-app support or long-document reliability. See [validation](VALIDATION.md).
