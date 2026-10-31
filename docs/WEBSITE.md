# Project website

The project landing page lives in `website/`. It is a static HTML/CSS website with no build step, external fonts, analytics, or runtime dependencies. It includes a Windows download link, a real application screenshot, a feature overview, and a four-step first-run tutorial.

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
