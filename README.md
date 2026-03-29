# Recorder

[![CI](https://github.com/gustavo-gardusi/browser-recorder/actions/workflows/ci.yml/badge.svg)](https://github.com/gustavo-gardusi/browser-recorder/actions/workflows/ci.yml)
[![Coverage Gate](https://img.shields.io/badge/coverage_gate-100%25-brightgreen)](https://github.com/gustavo-gardusi/browser-recorder/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-22.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

MVP Chrome extension that records browser tab activity, focused on accumulated page content.

Snapshots are queued, enriched, and exported as a downloadable session zip.

## Features

- Captures accumulated page content after recording starts, based on tab interactions and polling changes.
- Uses a background processing queue to dedupe and enrich snapshots before export.
- Exports a zip with canonical JSONL snapshots and metadata.
- Includes quick popup presets and advanced options for filters and storage limits.

## Architecture at a Glance

```mermaid
flowchart LR
popup[Popup UI] --> bg[Background Worker]
options[Options UI] --> bg
content[Content Script] -->|CONTENT_PAGE_SNAPSHOT| bg
bg --> raw[(raw_pages)]
bg --> queue[(page_queue)]
bg --> enriched[(enriched_pages)]
bg --> zip[Zip Export]
zip --> download[Chrome Downloads]
```

## Requirements

- Node.js `22.x`
- Chrome/Chromium with Developer Mode enabled for unpacked extensions

## Setup

1. Install dependencies:

```bash
npm install --registry=https://registry.npmjs.org
```

2. Build and print browser loading steps:

```bash
npm run setup:browser
```

3. In Chrome:
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked**
   - Select this repo's `dist/` folder
   - If already loaded, click **Reload**

4. Optional quality checks:

```bash
npm run check
npm run format
npm run format:local
```

## Usage

1. Open extension popup and click **Start**.
2. Recorder starts listening on open tabs and appends snapshots after post-start interactions/changes.
3. Navigate pages normally in Chrome.
4. Click **Stop** when done.
5. Click **Export Session** to download `recordings/<sessionId>.zip` to your Downloads folder.

You can also click **Clear Session Data** to reset local captured records.

## Common Commands

```bash
npm run dev
npm run test:coverage
npm run lint
npm run typecheck
npm run format:local
```

## Storage and Files

- Capture pipeline data is stored in IndexedDB (`raw_pages`, `page_queue`, `enriched_pages`).
- Recorder enforces a hard size limit and drops new snapshots once the limit is reached.
- Popup offers short capture presets (`Pages only`, `Pages + requests`, `Full capture`).
- Popup has **Open all settings** for advanced filters and safe quota limits (`6/8/9/10 MB`).
- Export creates a zip in Downloads as `recordings/<sessionId>.zip`.
- Zip contents include:
  - `pages.jsonl` (canonical enriched page snapshots)
  - `metadata.json` (session id, export timestamp, counts, settings)
- Repository includes `recordings/.gitkeep` to reserve a local recordings folder for future shared tooling.

See [`docs/recording-format.md`](docs/recording-format.md) for schema details.
See [`docs/execution-flow.md`](docs/execution-flow.md) for the startup and dedupe execution flow.
For a full runbook to load in Chrome and verify captured results, see [`docs/install-and-verify.md`](docs/install-and-verify.md).

## Privacy Defaults

- URL query params with sensitive key names are redacted in exported page metadata.
- Request URLs are redacted with the same sensitive query-key rules when request capture is enabled.

## MVP Limitations

- Snapshot coverage depends on rendered text availability in the page context.
- Some URLs (for example, `chrome://`) cannot be captured by extension content scripts.
- Export writes to Chrome's download target (not directly to project path) due extension sandboxing.

## Phase 2 (Planned)

- Add optional Native Messaging helper for direct writes to a global shared folder.
- Keep current schema stable for additive evolution.
