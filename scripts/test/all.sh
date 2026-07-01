#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
./scripts/test/unit.sh
./scripts/test/integration.sh
echo "==> test pipeline passed"
