# Install and Verify on Chrome (macOS)

This guide helps you load the extension in Chrome and confirm that page content is being captured.

## 1) Build

From the repo root:

```bash
npm install --registry=https://registry.npmjs.org
npm run build
```

## 2) Load as unpacked extension

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked**.
5. Select the project's `dist/` folder.

You should see **Recorder** in the extensions list.

## 3) Start a recording session

1. Click the extension icon in Chrome toolbar.
2. Pin **Recorder** if needed.
3. Open the popup and click **Start**.
4. Recorder starts listening on tabs with interaction-driven capture.
5. Interact with one or more pages/tabs after Start.

## 4) Generate page activity

To create a clear test trace:

1. Open a dynamic page (for example, Slack, ChatGPT, or dashboards).
2. Interact with clicks/scroll/routes to trigger text updates.
3. Move across a couple pages/routes so multiple snapshots are captured.

## 5) Export and inspect results

1. Open extension popup again.
2. Click **Stop**.
3. Click **Export Session**.

Chrome downloads a zip file like:

- `recordings/<sessionId>.zip`

In Finder, open your Downloads folder, unzip it, and inspect:

- `metadata.json`
- `pages/<urlPrefix>/<safeUrlBasename>.txt`

## 6) What to expect in files

- `metadata.json` includes session id, export timestamp, counts, website/page summaries, index text, and effective settings.
- `pages/<urlPrefix>/<safeUrlBasename>.txt` is one file per captured URL (nested by host prefix).
- Each page file contains multiple `---` snapshot blocks with `timestamp`, `url`, `title`, `reason`, `tabId`, `windowId`, and `content:`.
- If page HTML capture is enabled, blocks also include `htmlContent:`.
- Sensitive query parameters in URLs are redacted by default as `[REDACTED]`.

## Troubleshooting

- If the popup says no session is active, click **Start** before navigating.
- If capture seems empty, try reloading the tab after starting.
- Some pages may expose limited `innerText` depending on app rendering and browser protections.
