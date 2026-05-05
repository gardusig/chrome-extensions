# Documentation

All documentation for this repository lives here (not under individual `extensions/` folders).

## Getting started

| Document                                                   | Use when…                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [local-development.md](local-development.md)               | You want to **build** an extension from this repo and **load it unpacked** in Chrome (developer workflow).                |
| [chrome-web-store-release.md](chrome-web-store-release.md) | You want to **publish** an extension to the Chrome Web Store **or install** a published build on **your Google profile**. |
| [Contributing guide](../CONTRIBUTING.md)                   | You’re changing the repo, CI, or adding another extension under `extensions/`.                                            |

## Recorder extension

| Document                                                     | Contents                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [recorder-recording-format.md](recorder-recording-format.md) | Exported zip naming, folder layout, `.txt` snapshot blocks, IndexedDB overview. |
| [recorder-execution-flow.md](recorder-execution-flow.md)     | Start/stop, polling, dedupe, worker, export, clear, force-stop.                 |
| [recorder-install-verify.md](recorder-install-verify.md)     | Short smoke test after loading unpacked Recorder.                               |

## Repository direction

| Document                                   | Contents                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| [monorepo-roadmap.md](monorepo-roadmap.md) | Optional future layout (`apps/` / `packages/`) if multiple extensions share more code. |
