# Recording format (v1)

Recorder persists capture data in **IndexedDB** while recording and, when you click **Export**, downloads a single zip into Chrome’s **Downloads** folder.

There is **no** session-level `metadata.json` at the zip root for the primary workflow—value lives in **per-page `.txt`** files.

## Downloaded zip filename

The archive name is:

`recorder-session-YYYY-MM-DDTHH-mm-ss.zip`

The timestamp uses **UTC** fields (`getUTC*`) so the basename is stable regardless of the machine timezone. Time segments use **hyphens** instead of colons so the name is filesystem-safe.

Example: `recorder-session-2026-05-05T14-30-00.zip`.

## Inner layout

One folder per **site bucket** (hostname with `.` → `-`), each containing one `.txt` per captured URL slug:

```text
recorder-session-2026-05-05T14-30-00.zip
├── www-example-com/
│   └── www-example-com-docs-page.txt
└── app-example-com/
    └── app-example-com-dashboard-index.txt
```

Each `.txt` contains one **merged DFS outline** for that URL:

- The recorder converts each captured HTML into a normalized tree.
- New polls only add vertices/edges that are not already in the URL graph.
- Export walks the graph with DFS and writes lines with **tab indentation by node depth**.

## Page text format

The page file is plain text. Each line is one merged vertex text value:

- Depth 0: no leading tabs.
- Depth 1: one leading tab.
- Depth N: `N` leading tabs.

If a vertex text has multiple lines, each emitted line gets the same depth indentation.

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
