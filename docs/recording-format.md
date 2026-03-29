# Recording Format (MVP)

Recorder stores capture data in IndexedDB during recording, and exports a zip file into your Downloads folder as `recordings/<sessionId>.zip`.

## Export Structure

Zip entries:

- `pages/<urlPrefix>/<safeUrlBasename>.txt` (one text file per full URL, using sanitized URL basename)
- `metadata.json` (session/export metadata)

Within each page file, snapshots are sorted by `timestamp` (oldest first).

## Page Text Entry Format

Each snapshot block is delimited by `---` and contains:

- `timestamp`
- `url`
- `title`
- `reason`
- `tabId`, `windowId`
- `content:` (captured text, when enabled)
- optional `htmlContent` (captured HTML, when enabled)

## Redaction Defaults

URL query params containing sensitive key names are redacted as `[REDACTED]` in captured page metadata.

## `metadata.json` Format

`metadata.json` includes:

- `sessionId`
- `exportedAt`
- `pageCount`
- `urlCount`
- `summary` (counts + start/end/duration)
- `websites` (per-prefix aggregate stats with nested per-URL aggregates)
- `indexText`
- `settings` (effective recorder settings at export time)

## MVP Constraints

- Local capture uses IndexedDB and enforces a hard byte limit.
- Hard-limit settings are user-configurable (`32/64/128/256/512/1024 MB`, default `32 MB`).
- Export is lock-guarded per session id to prevent concurrent duplicate exports.
- Zip entry modified-time fields are currently emitted as DOS zero values, which some unzip tools display as `1980-01-01`.
