# chrome-extensions

[![CI](https://github.com/gardusig/chrome-extensions/actions/workflows/ci.yml/badge.svg)](https://github.com/gardusig/chrome-extensions/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-22.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

This repository is a **workspace for Chrome extensions** (Manifest V3). Each extension lives under [`extensions/`](extensions/) with its own source and build output. **All documentation** is in [`docs/`](docs/README.md).

## Current extensions

| Extension                                     | Description                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| [**Recorder**](extensions/recorder/README.md) | Timer-based page snapshots, IndexedDB pipeline, export zip when stopped. |

Recorder docs: [recording format](docs/recorder-recording-format.md) · [execution flow](docs/recorder-execution-flow.md) · [smoke test](docs/recorder-install-verify.md).

## Quick start (from repository root)

```bash
npm ci
npm run build
npm run setup:browser
```

Then in Chrome → **Extensions** → **Load unpacked** → select **`extensions/recorder/dist/`** (see [docs/local-development.md](docs/local-development.md) and [CONTRIBUTING.md](CONTRIBUTING.md)).

**Publish or install from the store:** [docs/chrome-web-store-release.md](docs/chrome-web-store-release.md). **Doc index:** [docs/README.md](docs/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, checks, and how to add another extension under `extensions/`.
