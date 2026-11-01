# Project website

The project landing page lives in `website/`. It is a static HTML/CSS/JavaScript website with no build step, external fonts, analytics, or runtime dependencies. It includes a Windows download link, a real application screenshot, a feature overview, and a four-step first-run tutorial.

The page title, description, social metadata and visible introduction identify the project as a **Grok Build GUI for Windows**, with “graphical user interface (GUI)” spelled out in the hero copy. A canonical URL identifies the GitHub Pages location. This wording clarifies the product; search indexing and rankings are not guaranteed. `tests/ui/website-gui.spec.ts` checks the metadata and desktop/mobile layout.

The header's **Theme** selector offers **System**, **Light**, and **Dark**. System is the default and follows operating-system changes while the page is open. Explicit choices are remembered in browser-local storage; selecting System clears the override. If storage is blocked, the selector still works for the current page. This controls the website's appearance; the app has its own Appearance settings.

## Preview locally

From the repository root, use the existing development dependencies (`npm ci` if needed):

```powershell
npx vite website --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173`. The page can also be opened directly from `website/index.html`.

## Publish with GitHub Pages

The `Publish project website` workflow uploads only `website/` and deploys it to GitHub Pages on pushes to `main` that touch the website or its workflow. It can also be run manually. Website-only commits skip the Windows portable build; they do not publish an application release.

The repository is configured to use **Settings → Pages → Build and deployment → Source → GitHub Actions**. The project URL is `https://robbyjo.github.io/Grok-Workbench/`; the deployment job reports the URL after success. For a fork, enable this setting once. If Pages has not been enabled, the configure step fails with a setup message rather than changing repository settings automatically.

## Update content

- Edit `website/index.html` for copy, tutorial steps, and links; edit `website/styles.css` for layout.
- When publishing a new app version, update the version label, executable link/name, release notes, checksum link, and screenshot caption together. Check these against the release assets and README.
- Keep asset URLs relative so the page works under the repository subpath and in local previews.
- Check desktop and mobile widths, keyboard navigation, image loading, and download/documentation links before pushing.

## Screenshot provenance

`website/assets/workbench-screenshot.png` is an unmodified application screenshot from the local `tests/ui/desktop.spec.ts` acceptance run on October 29, 2026 (`.test-data/desktop-welcome.png`). It shows the real 0.8.4 desktop interface and a disposable local test project, with no account credentials or private conversation. The caption explicitly identifies the test project. Click the screenshot on the website to view it at full size.

SHA-256: `3D948A614E1DB18B5DB7348B7990E5937ED0A1031A8CB6F1106785E4598C4C06`.
