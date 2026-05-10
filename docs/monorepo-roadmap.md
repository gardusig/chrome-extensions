# Monorepo roadmap (optional)

Long-term direction if this repository grows multiple extensions with shared runtime code.

## Goal

Evolve from a single-extension-focused layout into a reusable baseline where each extension is one app among several, sharing modules and test tooling where it pays off.

## Possible future layout

```text
apps/
  recorder-extension/
  <future-extension>/
packages/
  extension-core/
  extension-ui/
  test-utils/
```

- **`apps/recorder-extension`**: independent manifest and release cadence.
- **`packages/extension-core`**: shared utilities (typed messaging helpers, storage keys, redaction).
- **`packages/extension-ui`**: shared popup/options patterns.
- **`packages/test-utils`**: shared Chrome mocks and fixtures.

## What to share first

1. Message envelope types and request/response wrappers.
2. Storage helpers and normalization patterns.
3. Download/export helpers.
4. Shared test mocks (`tests/support`-style).

## Migration path (low risk)

1. Keep **`extensions/<name>/`** today; extract reusable helpers under each extension’s **`src/lib`** first.
2. When a **second** extension lands with real overlap, introduce **`packages/*`** and optionally rename **`extensions/`** → **`apps/`**.
3. Keep each app’s manifest, permissions, and build output isolated.

## Risks

- Over-generic abstractions can slow product-specific work.
- Shared package changes can affect multiple extensions.
- Tooling and CI fan-out cost more to maintain.

## Current stance

Stay with **`extensions/recorder/`** + shared root **`npm run build`** until a second extension needs a structural split; keep utilities behind small, stable interfaces so migration stays incremental.
