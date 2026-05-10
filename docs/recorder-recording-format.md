# Recording format (v1)

Recorder persists capture data in **IndexedDB** while recording and, when you click **Export**, downloads a single zip into Chrome’s **Downloads** folder.

There is **no** session-level `metadata.json` at the zip root for the primary workflow—value lives in per-site text/jsonl files.

## Downloaded zip filename

The archive name is:

`recorder-session-YYYY-MM-DDTHH-mm-ss.zip`

The timestamp uses **UTC** fields (`getUTC*`) so the basename is stable regardless of the machine timezone. Time segments use **hyphens** instead of colons so the name is filesystem-safe.

Example: `recorder-session-2026-05-05T14-30-00.zip`.

## Inner layout

The archive now uses a stable `recorder/` prefix with one file per site bucket (hostname with `.` → `-`) in each logical section:

```text
recorder-session-2026-05-05T14-30-00.zip
└── recorder/
    ├── requests/
    │   └── www-example-com.jsonl
    ├── metadata/
    │   └── www-example-com.txt
    └── content/
        └── www-example-com.txt
```

Semantics:

- `requests/{site}.jsonl`: ordered request list (one JSON object per line).
- `metadata/{site}.txt`: deduped metadata lines for the site.
- `content/{site}.txt`: deduped readable text lines merged from all URLs under that site.

## Content text format

The content file is plain text and line-oriented:

- Each line is a unique, non-empty readable text segment derived from the merged graph.
- Lines are deduped and sorted at export time.
- Because export normalizes per-line values, depth indentation is not preserved in this output.

## IndexedDB model (summary)

Conceptually there are three capture/processing tiers; the extension splits raw HTML across two object stores:

| Tier             | Role                                                                                                             | Object store name(s) in IndexedDB (`recorder-idb`) |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Raw queue        | Dedupe key = SHA-256 hex of full `outerHTML`; holds `rawHtml` and poll metadata for the worker.                  | `raw_html_by_digest`, `poll_meta_by_digest`        |
| Processed output | One merged graph per `fullUrl` (`vertices`, `childrenByParent`; DFS starts at `childrenByParent["__root__"]`).   | `processed_by_url`                                 |
| Ledger           | Monotonic `seq`; **Clear old** drops the oldest seq and removes vertices whose `introducedLedgerSeq` matches it. | `snapshot_ledger`                                  |

Sidecar data (also counted in **Output** / force-stop estimates): **`site_metadata_lines`**, **`site_request_log`**.

Schema details and worked examples: **[recorder-merged-graph-schema.md](recorder-merged-graph-schema.md)**.

The in-memory **digest queue** is not persisted; stopping recording clears the queue and the **raw** object stores (`raw_html_by_digest`, `poll_meta_by_digest`).

## Tests and fixtures

Unit tests live under **`extensions/recorder/tests/`** (schema, memory IDB shape, pipeline, export zip bytes/naming).
