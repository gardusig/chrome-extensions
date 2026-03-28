# Recorder

[![CI](https://github.com/gustavo-gardusi/browser-recorder/actions/workflows/ci.yml/badge.svg)](https://github.com/gustavo-gardusi/browser-recorder/actions/workflows/ci.yml)
[![Coverage Gate](https://img.shields.io/badge/coverage_gate-100%25-brightgreen)](https://github.com/gustavo-gardusi/browser-recorder/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-22.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

MVP Chrome extension that records browser tab activity, focused on accumulated page content.

Snapshots are grouped by session and exported per host as both text and JSONL files.

## Features

- Captures accumulated page content after recording starts, based on tab interactions and polling changes.
- Exports one page file per hostname (`pages/<host>.txt`) plus canonical JSONL (`pages/<host>.jsonl`).
- Supports optional request capture and export (`requests/<host>.txt`) in advanced settings.
- Includes quick popup presets and advanced options for filters and storage limits.

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
5. Click **Export Session** to download artifacts to your Downloads folder under `recordings/<sessionId>/...`.

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

- In-memory/session data is kept in `chrome.storage.local` while recording.
- Recorder enforces storage limits and drops oldest records first when near quota.
- Popup offers short capture presets (`Pages only`, `Pages + requests`, `Full capture`).
- Popup has **Open all settings** for advanced filters and safe quota limits (`6/8/9/10 MB`).
- Export creates one page file per host for the session (for example, `pages/github.com.txt`).
- Export also creates one JSONL page file per host (for example, `pages/github.com.jsonl`) for LLM-friendly ingestion.
- When request capture is enabled in advanced settings, export also includes `requests/<host>.txt`.
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
