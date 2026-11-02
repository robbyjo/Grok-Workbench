# Office, shopping, art, science and chess

Version 0.9.0 includes these Workbench-hosted tools on the unchanged embedded Grok Build **1.0.45** source, revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8` (binding 0.6.0). They do not depend on an undocumented Grok desktop API.

## Start a task

Open a project and chat, expand **Desktop & read aloud → Office, shopping, art, science & chess**, and enable the application tools you need for that chat. Choose a task starter, edit the request, then select **Run this task with Grok**. App launch buttons open installed applications only when clicked. Starting a workflow does not install software.

Word/Excel, Blender, JMP and Krita each have a separate opt-in grant. Grants reset on restart and are revoked when the chat disconnects, is archived/hidden, changes engine, or remote access starts. Cancel/Stop ends the active application job. Native operations already delivered to an application may still finish; inspect their output before retrying. Turning off a grant also cancels its active job. Existing Grok MCP permission controls still apply.

For general UI interaction, select and enable one Windows window in the parent panel. The native bridge now supports double-click, drag paths, accessibility-reference dragging and Ctrl/Shift/Alt application shortcuts, in addition to click, literal typing, scroll and accessibility controls. Each input still needs a fresh screenshot and is scoped to the selected window. **Check desktop input** diagnoses foreground/input-desktop availability; an active Remote Desktop session must actually expose the unlocked input desktop. New dialogs in separate windows need their own selection. See [desktop controls](DESKTOP-AND-READ-ALOUD.md).

## Supported workflows

| Workflow   | Tools and result                                                                                                                                                             | Current limits                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Office     | `office_create` creates new Word DOCX documents with paragraphs/tables, or Excel XLSX workbooks with typed cells, calculated formulas and an optional column chart.          | Installed desktop Microsoft Office required. Does not edit existing documents. Supported formulas are arithmetic and a small function allowlist; external links, DDE, macros and network functions are excluded. Literal text cells remain text.                                                                                                                                                      |
| Blender    | `blender_create` runs installed Blender separately with factory startup and produces an editable `.blend`, PNG render and object manifest.                                   | Cube, sphere, cylinder, plane and torus primitives with names, transforms and RGBA materials; 1–80 objects. This is a procedural scene starter. Complex modeling, animation, sculpting and finished-art quality are unvalidated.                                                                                                                                                                      |
| Krita      | `krita_tools` discovers and proxies the existing Krita MCP tools for new documents, native drawing/painting, layers, previews and save/export.                               | Existing offline-installed `krita-codex-mcp==0.2.2`, `uvx` and a working Krita bridge required. New canvases are at most 4096×4096, four open per chat. Only this chat's newly created documents may be activated, edited, previewed or closed. Existing files cannot be opened through this wrapper. Use `krita_save_export` with new paths and `overwrite=false`; direct document-save is excluded. |
| Scientific | `jmp_analyze` creates a new native JMP scatterplot and linear fit, saved `.jmp` table, parameter-estimate CSV, PNG and reproducible JSL.                                     | Tested with JMP 16 and 3–5,000 finite numeric `[x,y]` pairs, ordinary least squares with an intercept. Native slope/intercept must agree with an independent centered OLS calculation before success is reported. This does not check regression assumptions, causality or scientific interpretation.                                                                                                 |
| Shopping   | Selected-window desktop tools inspect filters, products and carts; `shopping_plan` checks quantities, observed prices and budget using integer cents.                        | Research/cart preparation only. Unknown shipping/tax prevents a budget pass. No currency conversion or independent price/stock verification. The arithmetic tool cannot place orders. The general desktop grant is not a checkout interceptor; retain user control of real payment/order actions.                                                                                                     |
| Chess      | `chess_position` validates FEN, SAN/UCI moves, legal moves, turn, check/mate/draw and optional new PGN export. The desktop bridge can click/drag pieces on a selected board. | Rules use pinned chess.js 1.4.0; no playing engine is bundled. Use untimed offline practice. Visible-board/FEN synchronization is required. Lucas Chess is detected and can be launched, but its UI and chess.com were not live-tested. No rated online play was performed.                                                                                                                           |

Native application integrations currently require Windows. Detection covers the standard Microsoft Office `Office16` path, installed folders under `Blender Foundation`, JMP 16 under `SAS/JMP/16`, Krita's standard x64 install and per-user `LucasChessR`. An undetected/custom installation requires a future configurable-path implementation. Installation detection alone does not establish compatibility. These tools do not grant universal desktop proficiency or Codex parity.

`application_catalog` reports this chat's grants, installed-app detection, jobs and recent tool outcomes. `application_jobs` reports actual completion/errors and artifacts; a queued job is not a success. `application_preview` returns a completed job's PNG graph/render to the model for visual inspection. Only one typed Office/Blender/JMP job runs at once. Jobs have a three-minute deadline and bounded output. New files use unique directories under the project's `workbench-output`; they are retained when jobs finish or fail. The panel opens recognized artifacts. Scripts and input JSON remain available in the job directory for inspection, rather than being executed by an Open button.

Office automation creates a new document/workbook and preserves other open documents. Blender uses a separate process, preserving open scenes. JMP runs only Workbench-authored JSL and closes only its own table/report references; it never quits the user's JMP session. Cancellation cleanup identifies an owned hidden Office instance by PID and process start time. The two authored C# helpers are checked against their packaged SHA-256 manifests before launch.

## Krita setup and preservation

Workbench uses the already cached server via `uvx --offline --from krita-codex-mcp==0.2.2 krita-codex-mcp`. It does not download a server, restart Krita, change its plugin configuration, or expand native allowed roots. Configure the Krita bridge separately before enabling the grant. If the package is missing from the offline cache or the bridge is unavailable, the tool returns an error. Save/export destinations must already be in the native bridge's allowed roots; unlike typed Office/Blender/JMP output they may be outside `workbench-output`.

Inspect compatibility/state before an edit, preview before and after drawing, and retain an editable KRA when saving a result. Existing artwork is excluded from previews and edits by this integration. A previous active document is restored after closing the last owned document when the user's selection has not changed meanwhile. Native brush/color operations can affect tool state in the running Krita session; prefer drawing operations that restore their temporary settings. A timed-out mutation has an unknown outcome: do not blindly retry it. Inspect state or ask the user to inspect the application.

## Local shopping and chess practice

**Open local shopping / chess practice** opens a disposable loopback website with product filtering/cart review and an untimed mate-in-one board. Select its browser window for desktop control. The site has no retailer, account, checkout or payment integration. Board moves are validated server-side. Mutation requests require the session token and matching origin; the server validates the loopback Host header. Up to four practice sessions remain available until Workbench exits.

Example requests:

- “In the practice shop, filter to Blue, add two in-stock fountain pens, review the cart, and check the USD 60 budget including shipping and tax.”
- “Read the current FEN on the practice chess board. Validate a mating move for Black, drag the queen, and inspect the result.”
- “Create a new Word summary and an Excel cost table with Paper=12 and Ink=28; calculate their total and add a chart.”
- “Make a Blender scene with a blue cube, orange sphere and gray floor, then inspect the saved render.”
- “In JMP, graph and regress `[[1,3.1],[2,4.9],[3,7.2],[4,8.8],[5,11.1],[6,12.9]]`; report the native estimates and independent checks.”

Screenshots, application outputs and supplied data become context for the selected model. Local application APIs may also execute configured application add-ins. These grants and validations do not provide OS containment. Files remain in the workspace or explicitly selected Krita root; no additional cloud art or shopping service is enabled.

## Build and test

```powershell
npm run build
npm run desktop:build
npm test
npm run test:ui
npm run test:workstation -- --apps office,blender,jmp
npx tsx scripts/workstation-acceptance.ts --apps krita --krita-root 'ABSOLUTE\ALREADY_ALLOWED\SCRATCH_ROOT'
npm run test:workstation:live -- --home 'ABSOLUTE\AUTHENTICATED\GROK\PROFILE' --domains office,blender,jmp,krita,shopping,chess
```

The native tests require the corresponding installed applications. The Krita save test creates a uniquely named scratch directory beneath the already allowed root, saves/copies its new KRA/PNG, closes only its own document and removes only that scratch directory. Live tests use billable model requests, a temporary auth copy and a separate browser profile. They never use personal retailer accounts, place orders or join online games. Temporary Grok auth/config homes are removed after shutdown. Each live prompt has a ten-minute deadline; mutation timeouts are not retried. Reports stay under `.test-data/workstation-*`. See [validation evidence](VALIDATION.md) for tested versions, results and remaining limits.

See [desktop workflows in 0.9.0](DESKTOP-WORKFLOWS.md) for Office editing/slides, PDF/OCR, reports, file organization, the task browser, creative batches, research, audio and vectors.
