#!/usr/bin/env bash
# Unit gate — format, lint, typecheck, vitest (runs inside unit image).
set -euo pipefail
cd "$(dirname "$0")/../.."
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
