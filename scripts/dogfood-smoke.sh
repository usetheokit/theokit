#!/usr/bin/env bash
# Lightweight dogfood smoke: run the gates a contributor should pass locally
# before opening a PR. Currently the bundle-size budget check; extend as more
# fast, dependency-free smoke gates are added.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

echo "→ bundle budget check"
bash "$HERE/check-bundle-budget.sh"

echo "✓ dogfood smoke complete"
