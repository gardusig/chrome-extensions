# Recorder debug guide

Practical checks to debug missing or empty Recorder output.

## 1) Verify recording is active and ingest is moving

In the popup:

- Start recording and keep at least one `http(s)` tab focused.
- Check `Ingests`, `URLs`, and `Output` size.
- Stop recording before export.

If `Ingests` and `URLs` stay at `0`, no capture reached processing.

## 2) Inspect the service worker in real time

1. Open `chrome://extensions`.
2. Find **Recorder** and click **service worker** (`Inspect views`).
3. Keep DevTools open while you click Start/Stop and browse pages.

Use this console to confirm message flow and errors during capture and export.

## 3) Inspect IndexedDB state

In extension DevTools (`Application` tab):

- Open `IndexedDB` → `recorder-idb`.
- Inspect these stores:
  - `raw_html_by_digest`
  - `poll_meta_by_digest`
  - `processed_by_url`
  - `site_metadata_lines`
  - `site_request_log`
  - `snapshot_ledger`

Interpretation:

- `raw_html_by_digest` + `poll_meta_by_digest` are transient raw capture staging.
- `processed_by_url` + `snapshot_ledger` are durable output.
- `site_metadata_lines` is deduped per origin (set-like).
- `site_request_log` is append-only per origin (ordered list, with max-cap trimming).

## 4) Understand digest queue visibility

`extensions/recorder/src/lib/digest-queue.ts` is an in-memory FIFO only.

- Queue size is not persisted in IndexedDB.
- Queue is cleared on stop.
- Service worker lifecycle/reload also clears in-memory state.

So "queue size is empty in DB" is expected behavior.

## 5) Why content `.txt` can still look empty

`content` export is built from merged graph text. A file can be empty when:

- No readable text nodes are extracted from captured HTML.
- No successful captures were processed for that host.
- Recording happened on non-capturable pages (`chrome://`, restricted pages).

Check readable extraction quickly with fixtures/tests:

- `extensions/recorder/tests/unit/lib/capture-tree-pipeline.test.ts`
- `extensions/recorder/tests/unit/capture-worker-pipeline.test.ts`

## 6) Database/store quick checklist

If export looks wrong, verify in order:

1. `snapshot_ledger` count increases while recording.
2. `processed_by_url` has rows for visited URLs.
3. `site_metadata_lines` has expected origins.
4. `site_request_log` has expected request entries.
5. Export runs while stopped.

## 7) Useful related docs

- [docs/recorder-execution-flow.md](recorder-execution-flow.md)
- [docs/recorder-recording-format.md](recorder-recording-format.md)
- [docs/recorder-install-verify.md](recorder-install-verify.md)
