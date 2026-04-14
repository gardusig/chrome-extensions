# Generic Extension Repository Evaluation

## Goal

Evolve from a single-extension repository into a reusable baseline where the recorder extension is one application among multiple browser extensions, sharing core modules and test tooling.

## Proposed Monorepo Shape

```text
apps/
  recorder-extension/
  <future-extension>/
packages/
  extension-core/
  extension-ui/
  test-utils/
```

- `apps/recorder-extension`: current recorder app entrypoints (`background`, `content`, `popup`, `options`, HTML, manifest).
- `apps/<future-extension>`: additional extension apps with independent manifests and release cadence.
- `packages/extension-core`: shared runtime utilities (typed runtime messaging wrappers, storage key helpers, safe defaults, redaction helpers where applicable).
- `packages/extension-ui`: shared popup/options helpers (DOM guards, async action wrappers, status/message formatting).
- `packages/test-utils`: shared chrome mocks, fixture builders, and data-url helpers used by all app tests.

## What to Share First

1. Message envelope types and request/response wrappers.
2. Storage helper utilities and normalization patterns.
3. Download/export helper wrappers.
4. Shared test mock factory and fixtures.

These pieces have low product coupling and high reuse potential.

## Migration Path (Low Risk)

1. Keep this repository layout for now and extract reusable helpers into `src/lib`.
2. Introduce `packages/test-utils` semantics inside `tests/support` (already started).
3. When the second extension exists, move app-specific code into `apps/*` and shared logic into `packages/*`.
4. Keep each app build/test pipeline isolated, with shared packages versioned together.

## Risks and Tradeoffs

- **Coupling risk:** overly generic shared abstractions can slow product-specific iteration.
- **Release risk:** shared package changes can impact multiple extensions at once.
- **Manifest divergence:** permissions, host patterns, and entrypoints differ per extension; keep app ownership explicit.
- **Tooling complexity:** monorepo task orchestration and CI fan-out add maintenance overhead.

## Recommendation

Proceed with phase-1 structure in this repo (centralized tests + broad coverage) and defer physical monorepo migration until there is a second extension with concrete shared needs. Continue extracting shared utilities behind stable interfaces so migration can be incremental.
