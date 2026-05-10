# chrome-extensions

[![CI](https://github.com/gardusig/chrome-extensions/actions/workflows/ci.yml/badge.svg)](https://github.com/gardusig/chrome-extensions/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-22.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

This repository is a **workspace for Chrome extensions** (Manifest V3). Each extension lives under [`extensions/`](extensions/) with its own source and build output.

## Current extensions

| Extension                                     | Description                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| [**Recorder**](extensions/recorder/README.md) | Timer-based page snapshots, IndexedDB pipeline, export zip when stopped. |

Recorder docs: [recording format](docs/recorder-recording-format.md) · [execution flow](docs/recorder-execution-flow.md) · [smoke test](docs/recorder-install-verify.md).

## Documentation

### Getting started

| Document                                                             | Use when…                                                                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [docs/local-development.md](docs/local-development.md)               | You want to **build** an extension from this repo and **load it unpacked** in Chrome (developer workflow).                |
| [docs/chrome-web-store-release.md](docs/chrome-web-store-release.md) | You want to **publish** an extension to the Chrome Web Store **or install** a published build on **your Google profile**. |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                   | You’re changing the repo, CI, or adding another extension under `extensions/`.                                            |

### Recorder extension

| Document                                                                     | Contents                                                                                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [docs/recorder-system-design.md](docs/recorder-system-design.md)             | Architecture: Chrome processes, components, queue + worker, growth metrics, high/low-level diagrams. |
| [docs/recorder-recording-format.md](docs/recorder-recording-format.md)       | Exported zip naming, folder layout, content/metadata/request files, IndexedDB overview.              |
| [docs/recorder-execution-flow.md](docs/recorder-execution-flow.md)           | Start/stop, polling, dedupe, worker, merge, export, clear, force-stop.                               |
| [docs/recorder-merged-graph-schema.md](docs/recorder-merged-graph-schema.md) | Logical vertices/edges, root pointer, ledger trim, examples.                                         |
| [docs/recorder-install-verify.md](docs/recorder-install-verify.md)           | Short smoke test after loading unpacked Recorder.                                                    |
| [docs/recorder-debug.md](docs/recorder-debug.md)                             | Service worker, queue, IndexedDB, and capture-debug workflow for empty or partial exports.           |

### Repository direction

| Document                                             | Contents                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [docs/monorepo-roadmap.md](docs/monorepo-roadmap.md) | Optional future layout (`apps/` / `packages/`) if multiple extensions share more code. |

## Quick start (from repository root)

```bash
npm ci
npm run build
npm run setup:browser
```

Then in Chrome → **Extensions** → **Load unpacked** → select **`extensions/recorder/dist/`** (see [docs/local-development.md](docs/local-development.md) and [CONTRIBUTING.md](CONTRIBUTING.md)).

**Publish or install from the store:** [docs/chrome-web-store-release.md](docs/chrome-web-store-release.md). **Doc index:** [Documentation](#documentation).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, checks, and how to add another extension under `extensions/`.
