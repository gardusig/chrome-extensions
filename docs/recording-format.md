# Recording Format (MVP)

Recorder stores capture data in IndexedDB during recording, and exports a zip file into your Downloads folder as `recordings/<sessionId>.zip`.

## Export Structure

Zip entries:

- `pages.jsonl` (canonical structured page snapshots)
- `metadata.json` (session/export metadata)

## `pages.jsonl` Format

Each line is one snapshot object with:

- `id`
- `createdAt`
- `timestamp`
- `title`
- `url`
- `urlPrefix`
- `tabId`, `windowId`
- `reason`
- optional `textContent` (`document.body.innerText`, if enabled)
- optional `htmlContent` (`document.documentElement.outerHTML`, if enabled)
- `sectionCount`
- `contentSizeBytes`

Rows are sorted by `timestamp` before export.

## Redaction Defaults

URL query params containing sensitive key names are redacted as `[REDACTED]` in captured page metadata.

## `metadata.json` Format

`metadata.json` includes:

- `sessionId`
- `exportedAt`
- `pageCount`
- `urlPrefixCount`
- `settings` (effective recorder settings at export time)

## MVP Constraints

- Local capture uses IndexedDB and enforces a hard byte limit.
- Recommended safe hard limits without `unlimitedStorage` permission: `6/8/9/10 MB`.
- Export is lock-guarded per session id to prevent concurrent duplicate exports.
