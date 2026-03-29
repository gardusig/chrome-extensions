# Recording Format (MVP)

Recorder stores capture data in IndexedDB during recording, and exports a zip file into your Downloads folder as `recordings/<sessionId>.zip`.

## Export Structure

Zip entries:

- `pages/<urlPrefix>/<safeUrlBasename>.txt` (one text file per full URL, using sanitized URL basename)
- optional `metadata.json` (session/export metadata) when export metadata is enabled in settings

Within each page file, snapshots are sorted by `timestamp` (oldest first), but timestamp is summarized in a file-level index instead of repeated per snapshot block.
When adjacent snapshots repeat the same semantic chunk set, export compacts the repeated semantic section to:

- `[source=semantic selector=__compacted__ kind=info]`
- `<unchanged-from-previous-snapshot>`

## Page Text Entry Format

Each page file starts with a `# Page Index` header containing:

- `url`
- `startedAt`
- `endedAt`
- `durationSeconds`
- `snapshotCount`
- aggregate fields (`titles`, `reasons`, `tabIds`, `windowIds`)

After the header, each snapshot block is delimited by `---` and contains:

- `content:` (captured text, when enabled)
- optional `htmlContent` (flattened HTML-derived text, when enabled)

## Redaction Defaults

URL query params containing sensitive key names are redacted as `[REDACTED]` in captured page metadata.

## `metadata.json` Format

This file is emitted only when export metadata is enabled.

`metadata.json` includes:

- `sessionId`
- `exportedAt`
- `pageCount`
- `urlCount`
- `summary` (counts + start/end/duration)
- `websites` (per-prefix aggregate stats with nested per-URL aggregates)
- `index` (structured mirror of high-level session/website/page index data)
- `compaction` (`semanticChunksRaw`, `semanticChunksOmitted`, `snapshotsCompacted`)
- `settings` (effective recorder settings at export time)

## MVP Constraints

- Local capture uses IndexedDB and enforces a hard byte limit.
- Hard-limit settings are user-configurable (`32/64/128/256/512/1024 MB`, default `32 MB`).
- Export is lock-guarded per session id to prevent concurrent duplicate exports.
- Zip entry modified-time fields are currently emitted as DOS zero values, which some unzip tools display as `1980-01-01`.
