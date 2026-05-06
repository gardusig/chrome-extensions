# Recorder — install and verify (quick smoke test)

Short workflow to load **Recorder** from this repo and confirm capture + export.

**Prerequisites and troubleshooting:** **[local-development.md](local-development.md)**.

## 1) Build

From the repository root:

```bash
npm ci
npm run build
```

## 2) Load unpacked

1. Open Chrome → `chrome://extensions`.
2. Enable **Developer mode**.
3. **Load unpacked** → select **`extensions/recorder/dist/`** (the build output folder).

## 3) Record

1. Open the extension popup (pin the icon if needed).
2. Click **Start**.
3. Open one or more normal `https://` pages and wait through a few poll intervals (or interact minimally).

## 4) Export

1. Click **Stop** in the popup.
2. Click **Export**.

Chrome should download a zip named like **`recorder-session-YYYY-MM-DDTHH-mm-ss.zip`** (UTC-based timestamp). Unzip and inspect folders named by host, each containing one `.txt` per captured URL: a **merged** outline (tab-indented DFS of the stored graph), not separate snapshot blocks.

## 5) Clear data

Use **Clear…** → **Clear old** or **Clear all** when stopped to reclaim space (see Options for the output size limit).

## Troubleshooting

- If the extension does not load, confirm you picked **`dist/`** after a successful `npm run build`.
- If export does not appear, check Chrome’s download UI and macOS privacy settings for Chrome (see **[local-development.md](local-development.md)**).
- `chrome://` and other restricted URLs are not capturable by content scripts.
