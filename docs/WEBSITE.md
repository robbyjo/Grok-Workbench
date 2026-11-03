# Project website

The project landing page lives in `website/`. It is a static HTML/CSS/JavaScript website with no build step, external fonts, analytics, or runtime dependencies. The hero and a spotlight before downloads feature **v0.9.0 desktop use**. A gallery covers browser tasks, Office/science and creative workflows, with a separate read-aloud walkthrough. It also includes platform-specific downloads, the coding workspace screenshot, and a four-step first-run tutorial. Windows is unsigned alpha, Linux is experimental, and both Mac download labels explicitly say UNTESTED until volunteer validation.

The page title, description and social metadata identify a **Grok Build GUI for Windows, Linux and macOS**, with experimental/UNTESTED status distinguished in the visible downloads. A canonical URL identifies the GitHub Pages location. Search indexing and rankings are not guaranteed. `tests/ui/website-gui.spec.ts` checks metadata, download labels and desktop/mobile layout.

The header's **Theme** selector offers **System**, **Light**, and **Dark**. System is the default and follows operating-system changes while the page is open. Explicit choices are remembered in browser-local storage; selecting System clears the override. If storage is blocked, the selector still works for the current page. This controls the website's appearance; the app has its own Appearance settings.

## Preview locally

From the repository root, use the existing development dependencies (`npm ci` if needed):

```powershell
npx vite website --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173`. The page can also be opened directly from `website/index.html`.

## Publish with GitHub Pages

The `Publish project website` workflow uploads only `website/` and deploys it to GitHub Pages on website/workflow pushes to main, published releases, or manual dispatch. Before deploying, it reads the page's declared version and download URLs and requires every advertised asset to exist in a public release. During release preparation the current website stays online. After publication, dispatch the website workflow explicitly if the release was created with `GITHUB_TOKEN`, whose events do not start other workflows. Website-only commits skip application builds and do not publish app releases.

The repository is configured to use **Settings → Pages → Build and deployment → Source → GitHub Actions**. The project URL is `https://robbyjo.github.io/Grok-Workbench/`; the deployment job reports the URL after success. For a fork, enable this setting once. If Pages has not been enabled, the configure step fails with a setup message rather than changing repository settings automatically.

## Update content

- Edit `website/index.html` for copy, tutorial steps, and links; edit `website/styles.css` for layout.
- When publishing a new app version, update the version label, executable link/name, release notes, checksum link, and screenshot caption together. Check these against the release assets and README.
- Keep asset URLs relative so the page works under the repository subpath and in local previews.
- Check desktop and mobile widths, keyboard navigation, image loading, and download/documentation links before pushing.

## Screenshot provenance

`website/assets/workbench-screenshot.png` is an unmodified application screenshot from the local `tests/ui/desktop.spec.ts` acceptance run on November 1, 2026 (`.test-data/desktop-welcome.png`). It shows the real 0.8.5 desktop interface and a disposable local test project, with no account credentials or private conversation. The caption explicitly identifies the test project. Click the screenshot on the website to view it at full size.

SHA-256: `5D6163246D750E7FB2319F62844D0DE8B12BBC3677D8FE68CD6384FFD5749EE4`.

### Desktop-use images (November 2, 2026)

The two control-panel screenshots were captured from the **published v0.9.0 Windows portable**, SHA-256 `23f51fb00b3961e7242ded2b14a7de62c6da54266c680e3c56e84426a9650f59`, extracted to an isolated test folder. They show genuine UI regions with sample task text/file paths, without a signed-in account, private conversation, model response or generated speech. They are focused screenshot captures, not retouched or generated interface mockups. The other images are unmodified acceptance-test captures/outputs using synthetic data. Captions distinguish interface setup, local practice and native output. Every image links to its full-size PNG.

| Website image                  | Source and scope                                                                                                                                                              | SHA-256                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `desktop-workflows-v090.png`   | Public v0.9.0 tool selection and scientific-report starter; `.test-data/website-screenshot-provenance.json`.                                                                  | `0201f1afc276240c949ffa289f452ce13c5246275c11f91f1c4ed8f5e7d764ce` |
| `read-aloud-v090.png`          | Public v0.9.0 Windows window-selection and read-aloud controls; same capture manifest.                                                                                        | `723f9b46f1bd4c8f79e8d47a5231338dfa40bbd614de72034236bc19056fd072` |
| `desktop-shopping-demo.png`    | `.test-data/workstation-live-jm6KG4/shopping.png`; actual live Grok local shopping practice, without purchases or accounts.                                                   | `d732593e0afc6e4e31561829443583b76a5180d2b5bfec1995c0472bbf9ac20b` |
| `desktop-science-jmp.png`      | `.test-data/desktop-workflows-GfdDP6/workspace/workbench-output/85193fcd-a413-4d53-8865-6fd8cf03ef76/regression.png`; native JMP output for synthetic data.                   | `166bb45d5c015fc3b6ee402acfc615693fa0cae62f0b60019a8a0fb169d9869a` |
| `desktop-creative-blender.png` | `.test-data/workstation-wsV090/workbench-output/5485dc95-7eac-404a-8500-613f7f55c71e/scene.png`; native Blender primitive scene render, with editable scene saved separately. | `b520f25002dc71b4d918e31c4206683b54e7787e8471c4d3cd02c9c4bd5b272c` |
