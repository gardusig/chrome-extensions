# Recording Format (MVP)

Recorder stores data in Chrome extension local storage during capture, and exports files into your Downloads folder using a `recordings/<sessionId>/...` path.

## Session Structure

- `recordings/<sessionId>/session-metadata.json`
- `recordings/<sessionId>/pages/<host>.txt`
- `recordings/<sessionId>/pages/<host>.jsonl` (canonical structured page snapshots)
- `recordings/<sessionId>/requests/<host>.txt` (only when request capture is enabled)

During recording, the extension also tracks per-session host keys in storage under `recorder:host-index`.

## Page Snapshot File Format

Each host file starts with host metadata:

- `Host`
- `snapshotCount`

Then repeated snapshot entries, each including:

- `timestamp`
- `title`
- `url`
- `tabId`, `windowId`
- `reason`
- optional `sections` block with parser-separated chunks and indented lines
- blank line + captured page text (`document.body.innerText`, if enabled)
- optional full HTML (`document.documentElement.outerHTML`, if enabled)

## Request File Format (Optional)

When request capture is enabled:

- Files are grouped by host.
- Entries include:
  - `timestamp`
  - `method`
  - `type`
  - `url` (redacted query params)
  - `tabId`, `windowId`
  - `initiator` (if available)

## Redaction Defaults

URL query params containing sensitive key names are redacted as `[REDACTED]` in both page and request data.

## Canonical JSONL Contract

The JSONL page export is the source of truth for machine parsing. Each line contains one snapshot object:

- `sessionId`
- `timestamp`
- `tabId`, `windowId`
- `url`, `title`, `reason`
- `sections`: array of `{ title, lines }`
- `text` (optional)
- `html` (optional)

Use `pages/<host>.txt` for human reading and `pages/<host>.jsonl` for LLM and tooling pipelines.

## MVP Constraints

- Local capture uses `chrome.storage.local` with a quota-aware eviction policy; oldest request/page records may be dropped first when near limit.
- Recommended safe hard limits without `unlimitedStorage` permission: `6/8/9/10 MB`.
- Export is lock-guarded per session and files are overwritten per host to avoid duplicate `(<n>)` artifacts.
