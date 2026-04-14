# chrome-extensions

[![CI](https://github.com/gardusig/chrome-extensions/actions/workflows/ci.yml/badge.svg)](https://github.com/gardusig/chrome-extensions/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-22.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

This repository is a **workspace for Chrome extensions** (Manifest V3). Each extension lives under [`extensions/`](extensions/) with its own source, docs, and build output.

## Current extensions

| Extension                                                     | Description                                                                |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [**browser-recorder**](extensions/browser-recorder/README.md) | Records labeled page text snapshots per session and exports them as a zip. |

## Quick start (from repository root)

```bash
npm ci
npm run build
npm run setup:browser
```

Then in Chrome → **Extensions** → **Load unpacked** → select **`extensions/browser-recorder/dist/`** (see [CONTRIBUTING.md](CONTRIBUTING.md) for details).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, checks, and how to add another extension under `extensions/`.
