# Project website

The project landing page lives in `website/`. It is a static HTML/CSS/JavaScript website with no build step, external fonts, analytics, or runtime dependencies. It includes platform-specific downloads, a real application screenshot, a feature overview, and a four-step first-run tutorial. Windows is unsigned alpha, Linux is experimental, and both Mac download labels explicitly say UNTESTED until volunteer validation.

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
