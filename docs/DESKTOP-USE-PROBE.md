# Experimental desktop-use probe

This experiment tests whether the model selected by the existing Workbench
engine can complete a small visual GUI task. It does not add a general desktop
feature to Workbench and does not change the pinned engine or published release.

The target is a disposable Electron window, rendered at 900 × 600 pixels. It
shows a random six-digit confirmation code, a text field, and shuffled Reset,
Verify and Cancel buttons. Positions change between trials. In the last trial,
Verify and Cancel swap after the correct code is entered. Grok must observe a
fresh screenshot, rather than reuse the old button coordinates.

## Run the checks

Use the repository's Node.js 24+ dependencies, installed Electron, and the matching
`.runtime/studio-engine.node` / `engine.json`. Build the pinned engine with
`npm run engine:build` if it is missing. No engine upgrade is needed.

First run the **non-billable fixture check**:

```powershell
npm run test:desktop-use:fixture
```

This uses scripted inputs to verify the actual GUI, MCP transport and scoring.
It also exercises the actual embedded engine against a local simulated provider:
the model endpoint must receive the screenshot image, and the engine must expose
only `search_tool` and `use_tool`. These are transport/isolation checks, **not
evidence that Grok can perform the task**.

To attempt the **real model experiment**, explicitly select a signed-in Workbench
OAuth profile:

```powershell
npm run test:desktop-use -- --run --home "C:\path\Grok Desktop Data\grok" --trials 3
```

`--run` consumes real model quota and may incur inference charges. `--trials`
accepts 1–3, defaulting to 3. The model prompt has a 90-second timeout per trial;
engine/authentication/MCP startup has separate bounded timeouts. Each trial also
has a 12-turn agent limit and a 24-action window-tool budget. To select an exact
runtime-advertised model ID, append `--model model-id`; otherwise the isolated
engine's account default is used. The report records the selected identifier.

### Locate or refresh the sign-in

Open the **Grok Workbench executable**, click **Sign in to Grok** above Settings,
choose OAuth, and complete browser sign-in. The `grok` directory is the data
profile, not an executable directory. For a portable Windows app the profile is
`Grok Desktop Data\grok` beside that particular executable. If you move to an EXE
in another directory, use the profile beside that copy.

The live probe copies only `auth.json` into a new temporary Grok home, writes its
own minimal config and agent definition, and deletes its verified temporary
directory after normal shutdown. It does not edit the source profile, reuse its
MCP servers/hooks, or close an open Workbench app. Do not paste credentials into
chat or commit them. Authentication/network/startup errors produce `blocked`,
not a conclusion that the model lacks desktop capability.

## What the model can access

The `desktop_probe` MCP server exposes exactly:

- `screenshot`: capture only the disposable window and return its PNG.
- `click(x, y)`: send a left click within its 900 × 600 content area.
- `type(text)`: insert bounded plain text into the already focused control.

It exposes no DOM, selectors, UI tree, evaluator, filesystem, shell, clipboard,
external URLs, or arbitrary window selection. The model receives neither the
random code nor control coordinates as text. Input acknowledgements deliberately
do not reveal success. The private evaluator is used by the fixture controller
and scorer; it is never an MCP tool.

The custom agent suppresses instruction/skill discovery, disables subagents and
managed MCP sources, and filters native tools to MCP discovery/dispatch. Any
unexpected advertised native tool or MCP source blocks the preflight. This is
an application-level experiment, **not an OS security sandbox**: the native
engine still runs with the user's permissions. The broker itself can only
operate its one owned window. Software rendering avoids GPU capture failures
seen in the local Windows automation session.

## Evidence and interpretation

Each run prints its `.test-data/desktop-probe-*/report.json` path. The ignored
directory contains the actual PNGs, screenshot hashes, action sequence,
application/engine versions, probe source hashes, selected model, final UI state,
wrong-click count and cleanup status. The local provider's preflight screenshot
is trial 0; live model trials start at 1. Scripted and real model runs are labeled
separately.

A scored pass requires an actual verified UI state, an observation between typing
and verification, and a final screenshot displaying success. An assistant's
claim of completion is insufficient.

- `fixture-pass`: the scripted harness and native transport worked; no live
  model competence was tested.
- `model-pass`: every requested real-model trial met the score conditions.
- `model-fail`: completed real-model attempts did not meet those conditions.
- `blocked`: authentication, native startup, transport, timeout or cleanup
  prevented a clean result. Read the report before drawing a model conclusion.

Even three successful trials would establish only basic screenshot interpretation
and GUI interaction in this window. It would not validate operating other apps,
OS permissions, dialogs, scrolling, accessibility trees, long tasks, or general
desktop reliability. Review the evidence before considering a broader feature.

## Observed result — November 2, 2026

The Windows x64 experiment passed **3/3 real Grok 4.7 trials** after a fresh
Workbench OAuth sign-in. Each trial used six window actions, including three
screenshots, with zero incorrect/reset/cancel clicks. The third trial correctly
handled the Verify/Cancel position swap after typing. All three ended normally
with a verified UI state and an observed success screenshot; no permission
requests were rejected. The probe's temporary profile was removed afterward.

| Trial | Layout                         | Actual model | Result | Wrong clicks |
| ----- | ------------------------------ | ------------ | ------ | -----------: |
| 1     | Randomized                     | `grok-4.7`   | Pass   |            0 |
| 2     | Different randomized positions | `grok-4.7`   | Pass   |            0 |
| 3     | Randomized, then buttons move  | `grok-4.7`   | Pass   |            0 |

Evidence is the ignored local run
`.test-data/desktop-probe-BwBwkg/report.json` and its nine live-trial PNGs.
The local native addon was binding 0.6.0 at public source
`2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`, SHA-256
`6c327c6e4af4095a08739d9c14200d3bb47fff390a090b9384412a5d48bcd960`.
This records the actual development addon used, rather than asserting it is
byte-identical to the published CI package. No engine upgrade was performed.

The result demonstrates basic visual grounding and screenshot-guided interaction
for this account/model and this small target. It does not establish support for
arbitrary desktop apps or dependable unattended computer use. The earlier expired
OAuth profile produced `blocked` with zero trials and was not scored as a model
failure.
