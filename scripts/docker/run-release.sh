#!/usr/bin/env bash
set -euo pipefail
cd /app
npm run build
tag="${GITHUB_REF_NAME:-snapshot}"
mkdir -p /artifacts
(cd extensions/recorder/dist && zip -r "/artifacts/recorder-${tag}.zip" .)
