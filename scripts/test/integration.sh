#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=../docker/_common.sh
source "$(dirname "$0")/../docker/_common.sh"
run_integration_tests
