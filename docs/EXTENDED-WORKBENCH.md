# Extended workbench (unreleased source)

These additions are available in the source checkout. The published 0.8.4 executable does not contain them. Existing native engine/storage formats and the adjacent portable profile are retained.

## Scheduled automations

Open **Settings → Automations & PR watches**. Choose a project, a prompt, and either a new chat for each run or an existing chat. Select an interval (at least five minutes), a one-time date in this computer's timezone, or a daily time with an explicit IANA timezone. A new chat can use a provider profile; an optional engine model ID can override the default. Existing chats retain their provider unless a model is explicitly selected.

**Enable scheduled execution** authorizes future model requests with normal account billing, project trust and chat tool permissions. Save without that checkbox to prepare a paused task. Workbench must remain open; there is no Windows service, OS wakeup or execution after quitting. Missed occurrences are coalesced, with no backlog replay. Daily tasks skip nonexistent daylight-saving times and execute at most once per local date. Busy chats, queued prompts, unsaved editor drafts and managed workspace operations defer execution.

The engine's normal approval/question UI remains authoritative. This feature does not grant tool approvals. A scheduled turn that fails or is stopped pauses its schedule. Run records are durably claimed before dispatch. Restart marks unfinished records interrupted instead of automatically resending an uncertain model request. At most two background runs execute concurrently, within the existing eight-engine connection ceiling. Up to 100 schedules and 200 recent run records are retained. Run output remains in the associated chat; open it from **Recent runs**. Cancelling a run stops its owned agent turn and also prevents a still-configuring run from sending its prompt.

## PR monitoring and automatic continuation

In the same Settings category, choose an open chat and enter `owner/repository`, a PR number, and the continuation prompt. GitHub CLI must be installed and authenticated (`gh auth login`). Adding a watch reads an initial baseline; it does not immediately send a model request.

Every two minutes, Workbench compares the PR head, reviews, comments and check results. Monitor-only watches add a durable unread notice on a change. Optional **Automatically continue this chat when the PR changes** sends the saved continuation prompt with bounded GitHub context through the ordinary agent flow. GitHub text is labeled untrusted context. Changes while a chat is busy are coalesced; continuation is limited to six turns per watch per hour, with at least two minutes between deliveries. Closed/merged PRs pause their watches. Poll failures retain the last successful snapshot and are shown in Settings. Missing/archived/hidden target chats cannot receive continuation.

The watcher itself never posts comments, submits reviews, commits, pushes or merges. What an agent may subsequently do follows its prompt and existing permissions. The default continuation prompt reserves publication actions for explicit review. Up to 100 watches are supported. Polling and automatic continuation stop when Workbench closes. Real hosted PR lifecycle acceptance remains separate from the deterministic local polling tests.

## Remote access

Open **Settings → Remote access**, select the projects to share, and start access. Read access is the default. Separately enable **Allow remote prompts and stop requests** for control. All current, non-archived chats in selected visible projects are shared, including chats subsequently created there.

The HTTP server listens exclusively on `127.0.0.1`. Open the displayed local address for the mobile interface. For another device, supply an HTTPS reverse tunnel to that loopback port, or SSH port forwarding using the same local port number. Configure a fixed port before setting up the tunnel. For an HTTPS tunnel, enter its exact public origin before starting; it is included in the accepted Host/Origin set. Workbench does not install a tunnel service, open router/firewall ports, or expose an unauthenticated LAN listener.

Enter the pairing token in the remote page. The token stays in browser memory, never a URL, cookie or browser storage. The remote page shows bounded user/assistant/notice text; raw tools, reasoning payloads, settings, file APIs and credential APIs are excluded. Rendered remote messages use text nodes. Approval answers and structured questions require the desktop interface.

Authenticated REST endpoints:

```text
Authorization: Bearer <pairing-token>
GET  /v1/sessions
GET  /v1/sessions/{id}
POST /v1/sessions/{id}/turns
POST /v1/sessions/{id}/cancel
```

POST requests use `Content-Type: application/json`. Turn bodies are `{"text":"your prompt"}` and require an `Idempotency-Key` header of 16–100 letters, digits, underscores or hyphens. Retry the same request with the same key during the same pairing. Keys are reserved before dispatch; mismatched reuse is rejected, and failed/uncertain submissions are not silently retried as new work. After checking the chat, the mobile interface lets the user explicitly reset the pending request key. Requests are bounded to 64 KiB and prompts to 20,000 characters, with a 240-request/minute ceiling and 200 distinct turn keys per pairing.

**Stop and revoke access** invalidates the token and closes connections. Pairing does not survive restart, and interface crashes also stop remote access. Already accepted agent turns have their own **Stop run/Stop turn** controls. Activity metadata is bounded and process-local. Messaging-platform bridges and agent execution on remote SSH hosts are not implemented by this endpoint.

## Provider profiles

Open **Settings → Providers**. Presets fill base URLs/API formats for OpenRouter, DeepSeek, OpenAI, Anthropic and a loopback model server; enter the actual routing model ID and context window. Other compatible endpoints can use **Custom**. Chat Completions, Responses and Messages are passed to the native engine. Presets are editable configuration conveniences, not a claim that every hosted provider/model has been accepted live.

Review the generated non-secret `config.toml` block, then **Save reviewed provider**. Existing configuration text/comments are retained and stale writes are refused. The generated block uses named environment variables, never plaintext API keys. Keys use Electron's OS encrypted storage, or session-only memory when remembering is unchecked. Copying an encrypted portable profile to a different Windows account/computer can require re-entry. Session-only keys must be re-entered after restart, including for scheduled tasks.

Select **Provider for this chat** to bind a profile. Switching starts a fresh native session while retaining the desktop transcript; old transcript text is not automatically sent into that new session. Model choices remain subject to native managed requirements. An explicitly selected profile sets the native model default through its supported environment overlay and rechecks the selection before prompting. An existing `GROK_CONFIG_PATH` overlay must be reconciled first; valid inline JSON overlays are preserved when merging the model default. Profile endpoints require HTTPS, with HTTP allowed only for loopback model servers.

Only the selected profile's key is supplied to its owned engine helper; native tool environment policies still apply. Other or unavailable profile keys receive a non-secret sentinel to prevent unrelated-key fallback; a selected missing key is refused before use. A named credential guard also prevents the native xAI credential fallback when a generated model entry is used outside the desktop. A durable in-progress marker blocks engine startup after partial config/key writes. Edit and re-save the marked profile to repair it, or remove it after clearing its chat/schedule references. Up to 30 profiles are supported. Updating/removing profiles requires idle engines and does not modify an active tool run. Media generation continues to use the engine's existing native media clients and account requirements; custom inference profiles do not add arbitrary image/video provider clients.

## Documents, media and browser previews

The Files panel previews PDF, DOCX, XLSX, PPTX, Markdown and supported raster image/audio/video files. Document attachments can use the same preview. PDF pages render locally with bundled PDF.js and its local worker, with Previous/Next controls. No external document viewer service is used.

Office previews extract inert content: Word paragraphs, PowerPoint slide text, and worksheet stored values. They omit page layout, charts, embedded images and macros; formulas are never executed or recalculated. Worksheet row numbers and sparse cells are retained. Legacy `.doc`, `.xls` and `.ppt` require an external viewer. Parsing occurs in an owned worker with a timeout and bounded heap, archive expansion and output. Files are limited to 20 MiB, selected expanded XML to 16 MiB, and extracted output to 2 MiB. Worksheets are capped at 10 sheets, 200 source rows and 50 columns; slides at 50. Limits are shown instead of implying a complete Office rendering. Workspace boundary, private metadata and link checks apply.

**Files → Website preview** opens an HTTP(S) page in a separate, temporary browser window. It has no preload or desktop IPC, with Node disabled and Chromium sandbox/web security retained. Downloads, new windows and device permissions are denied. Cookies/storage are discarded when closed. This supports local development pages; it is not computer-use automation or DOM editing/Design Mode.

## Localization and personalization

**Settings → Appearance** offers English, Spanish, French, German, Indonesian and Japanese for navigation and common controls. Translations are bundled and authored locally; prompts, code, provider responses and advanced diagnostic/configuration prose retain their original language. This is explicitly scoped interface localization, not a claim that every sentence or engine-supplied label has been translated.

Personalization adds system-following light/dark themes, green/blue/purple/amber accents, system/Arial/Georgia interface fonts, Cascadia Code/Consolas/Courier New terminal fonts, comfortable/compact density and explicit reduced motion. Existing independent UI/log sizing is retained. Settings persist across restart and update open terminals/editors. Desktop pets, wallpaper packs and dictation are outside this implementation.

## Validation

The backend suite covers schedule/DST/claim recovery, cancellation, PR baselines/coalescing/failure/closure, real HTTP pairing/scope/origin/idempotency/revocation, provider configuration/key boundaries and repair, and bounded Office extraction. A real embedded-engine test uses a disposable local compatible endpoint, verifies the exact routing model/key, and checks that missing provider credentials do not forward an unrelated xAI key.

Desktop acceptance exercises provider configuration, a real embedded scheduled turn against that local endpoint, a paired mobile page with both read-only and control modes, document/PDF rendering, locale/appearance persistence and remote revocation/restart behavior. Website checks verify GUI metadata and desktop/mobile layout. These are local fixtures, not billable hosted provider acceptance, an external HTTPS tunnel/device test, a full translation/accessibility audit, or packaged-release acceptance. See [VALIDATION.md](VALIDATION.md) for recorded results.
