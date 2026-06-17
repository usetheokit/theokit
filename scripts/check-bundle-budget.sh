#!/usr/bin/env bash
# Bundle-size budget gate.
#
# Builds the default fixture (unless BUNDLE_SKIP_BUILD=1), then compares the
# LARGEST emitted `index-*.js` client chunk's gzipped size against the budget.
# Largest-chunk semantics (NOT sum). Gzip is measured via Node's zlib for
# portability (no dependency on a shell `gzip` binary).
#
# Env:
#   BUNDLE_BUDGET_KB   budget in KB (default 350)
#   BUNDLE_FIXTURE     project dir to scan (default: repo root)
#   BUNDLE_SKIP_BUILD  set to 1 to skip `theokit build` (scan existing output)
#
# Exit: 0 = under budget (prints "[bundle-budget] OK ..."),
#       1 = over budget (prints "[bundle-budget] FAIL ..." to stderr),
#       2 = no build output found.
set -euo pipefail

BUDGET_KB="${BUNDLE_BUDGET_KB:-350}"
ROOT="${BUNDLE_FIXTURE:-$(cd "$(dirname "$0")/.." && pwd)}"
ASSETS="$ROOT/.theokit/client/assets"

if [ "${BUNDLE_SKIP_BUILD:-0}" != "1" ]; then
  (cd "$ROOT" && npx theokit build >/dev/null 2>&1) || true
fi

if [ ! -d "$ASSETS" ]; then
  echo "[bundle-budget] build output not found at $ASSETS" >&2
  exit 2
fi

budget_bytes=$(( BUDGET_KB * 1024 ))
largest=0
largest_file=""
shopt -s nullglob
for f in "$ASSETS"/index-*.js; do
  gz=$(node -e "const z=require('zlib');const fs=require('fs');process.stdout.write(String(z.gzipSync(fs.readFileSync(process.argv[1])).length))" "$f")
  if [ "$gz" -gt "$largest" ]; then
    largest="$gz"
    largest_file="$(basename "$f")"
  fi
done

if [ -z "$largest_file" ]; then
  echo "[bundle-budget] build output not found (no index-*.js chunks in $ASSETS)" >&2
  exit 2
fi

if [ "$largest" -gt "$budget_bytes" ]; then
  echo "[bundle-budget] FAIL: $largest_file is $largest bytes gzipped (budget ${BUDGET_KB} KB = $budget_bytes bytes)" >&2
  exit 1
fi

echo "[bundle-budget] OK: $largest_file is $largest bytes gzipped (budget ${BUDGET_KB} KB)"
exit 0
