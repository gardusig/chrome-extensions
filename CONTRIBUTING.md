# Contributing

## Prerequisites

- **Node.js 22.x** (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml))
- **Chrome or Chromium** with Developer Mode for unpacked extensions

## Clone and install

```bash
git clone https://github.com/gardusig/chrome-extensions.git
cd chrome-extensions
npm ci
```

## Build and load an extension

From the **repository root** (where `package.json` lives):

```bash
npm run build
npm run setup:browser   # optional: prints Load unpacked steps
```

- **browser-recorder**: load **`extensions/browser-recorder/dist/`** in `chrome://extensions` (Developer mode → Load unpacked).

## Quality checks

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

Or run everything in one go:

```bash
npm run check
```

## Adding a new extension

1. Create a sibling folder under `extensions/<your-extension-name>/` (same level as `browser-recorder`).
2. Add its own `manifest.json`, entry HTML/TS, and `README.md`.
3. Extend the root [Vite config](vite.config.ts) (or introduce a separate build entry) so `npm run build` produces a loadable `dist/` for that extension.
4. Document it in the root [README.md](README.md) table.

## Pull requests

- Keep changes focused; match existing style and test patterns.
- CI runs format, lint, typecheck, tests with coverage, and build on pull requests.

## Manifest V3

Extensions here target **MV3** (service worker background, no remote code). Follow [Chrome extension documentation](https://developer.chrome.com/docs/extensions/mv3/) for permissions and packaging.
