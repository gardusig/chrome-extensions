# Chrome Web Store: publish an extension and use it on your profile

Use this guide for **any** extension built from **`extensions/<name>/`** whose production bundle lives in **`extensions/<name>/dist/`**.

## Part A — Ship a new version to the Chrome Web Store

### 1) Produce a store-ready zip

From the **repository root**:

```bash
npm ci
npm run build
```

Zip the **contents** of the extension’s **`dist/`** folder (the unpacked extension root), **not** the whole monorepo:

- Include **`manifest.json`**, service worker / scripts, popup/options HTML, and **`public/`** assets as emitted (e.g. **`icons/`**).
- Exclude **`src/`**, **`tests/`**, **`node_modules/`**, and anything not referenced by the manifest.

Example for Recorder (adjust paths if your extension name differs). Run from the repo root; name the zip however you like (often include manifest version in the filename):

```bash
(cd extensions/recorder/dist && zip -r ../../../recorder-mv3-store.zip .)
```

Naming is your choice (e.g. `recorder-mv3-1.2.3.zip`). That archive is what you upload in [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).

**Recorder-specific:** the zip **users download from the extension** when exporting a session is unrelated — session exports use names like `recorder-session-YYYY-MM-DDTHH-mm-ss.zip`. See **[recorder-recording-format.md](recorder-recording-format.md)**.

### 2) Version and manifest

- Bump **`version`** in **`extensions/<name>/manifest.json`** per [Semantic Versioning](https://semver.org/) for each submission.
- Align **`name`**, **`description`**, **`icons`**, and declared **permissions** with the listing and reviewer expectations.

### 3) Privacy policy and permissions

- Host a **privacy policy URL** that matches how you describe data use on the listing.
- In the dashboard, justify **each permission** in plain language.

### 4) Listing assets

Follow [Chrome Web Store image guidelines](https://developer.chrome.com/docs/webstore/images) for screenshots and promo images.

### 5) Review

Provide **clear reproduction steps** for reviewers (what to open, what to click, what should happen). Mention login-only or enterprise-only sites if relevant.

---

## Part B — Install the published extension on your Google profile

After the item is **published** (or approved for testers):

1. **Sign in** to Chrome with the **Google account** you want the extension on (same account as [Chrome Web Store](https://chrome.google.com/webstore) if you install from the listing).
2. Open your extension’s **public listing URL** (from the developer dashboard: **Store listing → View in Chrome Web Store**).
3. Click **Add to Chrome** / **Install** and confirm the permissions dialog.

### Same extension on multiple machines

If **Chrome sync** is enabled for extensions (**Settings → You and Google → Sync and Google services → Manage what you sync**), the extension can **sync** to other desktops where you use the same Google account — subject to org policies.

### Developer/test installs without the public listing

- **Private testers:** use **trusted testers** or **group publishing** in the developer dashboard so only invited accounts see the listing before public release.
- **Unpacked:** for day-to-day development, keep using **[local-development.md](local-development.md)** (`Load unpacked` → `extensions/<name>/dist/`).

### Updating when a new store version ships

Chrome usually updates extensions automatically. To force a check: **`chrome://extensions`** → enable **Developer mode** → **Update** (or wait for the background update cycle).

---

## Related

- Local unpacked workflow: **[local-development.md](local-development.md)**.
- Recorder behavior and export layout: **[recorder-execution-flow.md](recorder-execution-flow.md)** · **[recorder-recording-format.md](recorder-recording-format.md)**.
