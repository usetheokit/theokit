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
#   BUNDLE_FIXTURE     project dir to scan (default: fixtures/template-default)
#   BUNDLE_SKIP_BUILD  set to 1 to skip `theokit build` (scan existing output)
#
# The default used to be the REPO ROOT, which is a monorepo and not a TheoKit app: `theokit build`
# had nothing to build, the `|| true` swallowed the failure, and the gate exited 2 with "build output
# not found". It therefore never measured a bundle — a budget nobody was ever under or over.
# `fixtures/template-default` is what the gate always meant to measure; the test's own docblock says
# so ("runs `theokit build` against fixtures/template-default"). Backlog B-M67-14.
#
# Exit: 0 = under budget (prints "[bundle-budget] OK ..."),
#       1 = over budget (prints "[bundle-budget] FAIL ..." to stderr),
#       2 = no build output found.
set -euo pipefail

BUDGET_KB="${BUNDLE_BUDGET_KB:-350}"
ROOT="${BUNDLE_FIXTURE:-$(cd "$(dirname "$0")/../fixtures/template-default" && pwd)}"
ASSETS="$ROOT/.theokit/client/assets"

build_log=""
if [ "${BUNDLE_SKIP_BUILD:-0}" != "1" ]; then
  # The build is allowed to fail here: `BUNDLE_SKIP_BUILD=1` is a legitimate mode where the caller
  # already produced the output. But the log is KEPT, so that when the assets turn out to be missing
  # the message can say WHY instead of only that they are absent — the previous shape discarded the
  # only evidence and reported a symptom.
  # Invoked by RESOLVED PATH, not `npx`. The sibling helper
  # (`tests/integration/_helpers/build-template-default.ts`) hit `Command "theokit" not found` on CI
  # while passing locally with the same pnpm and lockfile — the difference was the package manager's
  # bin RESOLUTION, not the artifact. `npx` here is the same indirection, for a binary whose path
  # this repository already knows. Backlog B-M67-17.
  CLI="$(cd "$(dirname "$0")/.." && pwd)/packages/theo/dist/cli/index.js"
  if [ ! -f "$CLI" ]; then
    echo "[bundle-budget] the theokit CLI is not built at $CLI — run \`pnpm --filter theokit build\` first" >&2
    exit 2
  fi
  build_log="$( (cd "$ROOT" && node "$CLI" build) 2>&1 )" || true
fi

if [ ! -d "$ASSETS" ]; then
  echo "[bundle-budget] build output not found at $ASSETS" >&2
  if [ -n "$build_log" ]; then
    echo "[bundle-budget] the build that should have produced it said:" >&2
    echo "$build_log" | tail -20 >&2
  fi
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
