#!/usr/bin/env bash
# Integration gate — production build smoke (runs inside integration image).
set -euo pipefail
cd "$(dirname "$0")/../.."
npm run build
test -f extensions/recorder/dist/manifest.json
test -f extensions/recorder/dist/popup.js
