# Local development: build an extension and install it

This workspace holds one or more Chrome extensions under **`extensions/<name>/`**. Today the Vite build is wired to **[Recorder](../extensions/recorder/)**; the same workflow applies to any extension once its folder has a **`dist/`** output from `npm run build`.

## Prerequisites

- **Node.js 22.x** (see the root [README.md](../README.md) badge).
- **Google Chrome** (or Chromium) with support for **Manifest V3** unpacked loads.

## Repository layout (what matters for builds)

```text
chrome-extensions/          ← repository root; always run npm commands here
├── package.json            ← shared scripts: build, test, lint
├── vite.config.ts          ← build config (currently targets one extension root)
├── extensions/
│   └── recorder/           ← extension source
│       ├── manifest.json
│       ├── src/
│       ├── tests/          ← Vitest specs (`**/*.test.ts`)
│       ├── public/         ← static assets (e.g. icons), copied into dist/
│       └── dist/           ← produced by `npm run build` — this is what you load in Chrome
└── docs/                   ← documentation (this folder)
```

Load **`extensions/<extension-name>/dist/`** in Chrome — **never** `src/` or `public/` alone.

## Build (from the repository root)

```bash
npm ci
npm run build
```

For Recorder, output appears under **`extensions/recorder/dist/`** (manifest, JS bundles, `icons/`, HTML entrypoints).

Optional helper that echoes browser steps:

```bash
npm run setup:browser
```

## Install locally (unpacked)

1. Open **`chrome://extensions`**.
2. Enable **Developer mode** (toggle is usually top-right).
3. Click **Load unpacked**.
4. Select the **`dist`** folder for the extension you built, e.g. **`extensions/recorder/dist/`**.

Use **Reload** on the card after you rebuild. If Chrome shows errors, open **Errors** / **Service worker** on that card and fix the build before retrying.

### macOS notes

- **Developer mode** is required for sideloading.
- **Managed devices (MDM)** may block unpacked extensions or restrict downloads; use a profile where development is allowed.
- If an extension uses **downloads** (Recorder exports a zip), ensure Chrome can write to **Downloads** — check **System Settings → Privacy & Security → Files and Folders** (and the download bar for blocked files).

### Adding another extension later

1. Create **`extensions/<your-extension>/`** with `manifest.json`, scripts, and assets.
2. Update **`vite.config.ts`** (or add a dedicated config/script) so `npm run build` emits **`extensions/<your-extension>/dist/`**.
3. Register it in the root **[README.md](../README.md)** and follow **[CONTRIBUTING.md](../CONTRIBUTING.md)**.

## Verify Recorder works

After loading **`extensions/recorder/dist/`**, follow **[recorder-install-verify.md](recorder-install-verify.md)** for a minimal capture/export check.

## Quality checks before you push

From the repository root:

```bash
npm run check    # format, lint, typecheck, tests, build
```

## Related

- Publish or install from the store: **[chrome-web-store-release.md](chrome-web-store-release.md)**.
- Recorder export format: **[recorder-recording-format.md](recorder-recording-format.md)**.
