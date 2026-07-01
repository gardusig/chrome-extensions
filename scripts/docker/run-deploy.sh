#!/usr/bin/env bash
set -euo pipefail
cd /repo
git config --global --add safe.directory /repo
pip install --quiet "gardusig-cli @ git+https://x-access-token:${GITHUB_TOKEN}@github.com/gardusig/cli.git@main"
cli git deploy --yes
