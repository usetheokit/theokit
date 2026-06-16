#!/bin/bash
# Stop hook: end-of-session sanity checks (agnostic).
#
# Behavior:
#   1. TDD gate (warn-first): for every changed production source file, warn
#      if no sibling test file is detected in the same directory (heuristic;
#      supports common *_test.* / *.test.* / *.spec.* / test_*.* naming).
#   2. CHANGELOG discipline (HARD GATE — Inquebrável Rule 6 + cycle-review BLOCKER):
#      if production source changed but CHANGELOG.md did not, BLOCK.
#   3. Secret leak (HARD GATE — cycle-review BLOCKER): if newly tracked files
#      match secret patterns (.env / credentials* / *.pem / *.key), BLOCK.
#   4. Pre-release honesty (warn-first): if README.md was modified, scan for
#      unverified production-ready / SLA claims.
#
# Hard gates align with rules/cycle-review.md § Hard gates (BLOCKER-level).
# Warn-first items are advisory — output is fed to Claude as context.
#
# Exit codes:
#   0 — clean OR only advisory warnings emitted
#   2 — hard-gate violation (CHANGELOG missing or secrets committed)
#
# Override: setting STOP_VALIDATION_WARN_ONLY=1 reverts every gate to warn-first
# (escape hatch for legitimate bulk reorgs; document the rationale in CHANGELOG).

set -uo pipefail

# shellcheck source=lib/detect-layout.sh
source "$(dirname "$0")/lib/detect-layout.sh"

# ----------------------------------------------------------------------------
# Collect ALL modified files (unstaged + staged + last commit)
# ----------------------------------------------------------------------------
UNSTAGED=$(git diff --name-only 2>/dev/null || true)
STAGED=$(git diff --cached --name-only 2>/dev/null || true)
LAST_COMMIT=$(git diff --name-only HEAD~1..HEAD 2>/dev/null || true)

ALL_FILES=$(echo -e "${UNSTAGED}\n${STAGED}\n${LAST_COMMIT}" | sort -u | grep -v '^$' || true)

if [ -z "$ALL_FILES" ]; then
  exit 0
fi

WARNINGS=()
BLOCKERS=()

# Escape hatch
WARN_ONLY="${STOP_VALIDATION_WARN_ONLY:-0}"

# ----------------------------------------------------------------------------
# 1. TDD gate (warn-first) — heuristic test pairing
# ----------------------------------------------------------------------------
# Recognized source extensions: .go .py .ts .tsx .js .jsx .rs .java .kt .rb .cs
# Recognized test-name patterns in the same directory:
#   <name>_test.<ext>          (Go, Python, etc.)
#   <name>.test.<ext>          (TS/JS Jest convention)
#   <name>.spec.<ext>          (TS/JS Jasmine/RSpec)
#   test_<name>.<ext>          (Python pytest)
# Falls back to "ANY test file in the same directory" (idiomatic in some langs).
# Skips generated/doc files and obvious vendored/third-party trees.
SRC_CHANGED=$(echo "$ALL_FILES" \
  | grep -E '\.(go|py|ts|tsx|js|jsx|rs|java|kt|rb|cs)$' \
  | grep -vE '(^|/)(node_modules|vendor|dist|build|target|\.venv|__pycache__|\.next|\.nuxt)/' \
  | grep -vE '(_test|\.test|\.spec)\.[a-z]+$' \
  | grep -vE '(^|/)test_[^/]+\.[a-z]+$' \
  | grep -vE '(^|/)zz_generated[^/]*\.go$' \
  | grep -vE '(^|/)doc\.go$' \
  || true)

if [ -n "$SRC_CHANGED" ]; then
  MISSING_TESTS=()
  while IFS= read -r src_file; do
    [ -z "$src_file" ] && continue

    pkg_dir=$(dirname "$src_file")
    base_no_ext="${src_file##*/}"
    base_no_ext="${base_no_ext%.*}"
    ext="${src_file##*.}"

    # Candidate file names in same directory
    if [ -f "${pkg_dir}/${base_no_ext}_test.${ext}" ] || \
       [ -f "${pkg_dir}/${base_no_ext}.test.${ext}" ] || \
       [ -f "${pkg_dir}/${base_no_ext}.spec.${ext}" ] || \
       [ -f "${pkg_dir}/test_${base_no_ext}.${ext}" ]; then
      continue
    fi

    # Fallback: ANY test-named file in the same package directory
    found=$(find "$pkg_dir" -maxdepth 1 \( \
        -name "*_test.${ext}" -o -name "*.test.${ext}" -o -name "*.spec.${ext}" -o -name "test_*.${ext}" \
      \) -print -quit 2>/dev/null || true)
    if [ -n "$found" ]; then
      continue
    fi

    MISSING_TESTS+=("$src_file")
  done <<< "$SRC_CHANGED"

  if [ ${#MISSING_TESTS[@]} -gt 0 ]; then
    msg="TDD gate (warn-first) — Inquebrável Rule 7: the following production source files have no sibling test file detected:"
    for f in "${MISSING_TESTS[@]}"; do
      msg+="\n    - $f"
    done
    msg+="\n  See $ECO/rules/testing.md for the project's test pairing convention."
    WARNINGS+=("$msg")
  fi
fi

# ----------------------------------------------------------------------------
# 2. CHANGELOG discipline (HARD GATE — Inquebrável Rule 6 + cycle-review BLOCKER)
# ----------------------------------------------------------------------------
if [ -f "CHANGELOG.md" ]; then
  CODE_CHANGED=$(echo "$ALL_FILES" \
    | grep -E '\.(go|py|ts|tsx|js|jsx|rs|java|kt|rb|cs)$' \
    | grep -vE '(_test|\.test|\.spec)\.[a-z]+$' \
    | grep -vE '(^|/)(node_modules|vendor|dist|build|target|\.venv|__pycache__)/' \
    || true)
  if [ -n "$CODE_CHANGED" ] && ! echo "$ALL_FILES" | grep -qE '^CHANGELOG\.md$'; then
    msg="CHANGELOG.md not updated despite production source changes (Inquebrável Rule 6; cycle-review BLOCKER). Add an entry to [Unreleased] before stopping. Override with STOP_VALIDATION_WARN_ONLY=1 only when the change is a bulk reorg with the rationale documented separately."
    if [ "$WARN_ONLY" = "1" ]; then
      WARNINGS+=("$msg")
    else
      BLOCKERS+=("$msg")
    fi
  fi
fi

# ----------------------------------------------------------------------------
# 2b. Secret leak (HARD GATE — cycle-review BLOCKER)
# ----------------------------------------------------------------------------
SECRET_HITS=$(echo "$ALL_FILES" \
  | grep -E '(^|/)(\.env(\.[a-z0-9_-]+)?|credentials([._-][a-z0-9]+)?|[a-z0-9_-]*secret[s]?(\.[a-z0-9_-]+)?\.(ya?ml|json|env|txt))$|\.(pem|key|p12|pfx|jks)$' \
  || true)
if [ -n "$SECRET_HITS" ]; then
  msg="Secret-pattern files appear in this session's diff (cycle-review BLOCKER). Verify they are intentionally NOT secrets, or remove them before stopping:"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    msg+="\n    - $f"
  done <<< "$SECRET_HITS"
  if [ "$WARN_ONLY" = "1" ]; then
    WARNINGS+=("$msg")
  else
    BLOCKERS+=("$msg")
  fi
fi

# ----------------------------------------------------------------------------
# 3. README.md production claims
# ----------------------------------------------------------------------------
if echo "$ALL_FILES" | grep -qE '(^|/)README\.md$'; then
  README_DIFF=$(git diff -- '*README.md' 2>/dev/null || true)
  if echo "$README_DIFF" | grep -qiE '^\+.*\bproduction[[:space:]]?-?[[:space:]]?(ready|grade)\b'; then
    WARNINGS+=("README.md introduces a 'production-ready' claim. Until v1.0 with measured evidence, prefer 'designed for' or 'targeted at' framings ($ECO/rules/public-copy.md).")
  fi
  if echo "$README_DIFF" | grep -qiE '^\+.*\b(99\.9|99\.95|99\.99)[[:space:]]?%[[:space:]]?(uptime|sla)'; then
    WARNINGS+=("README.md introduces a specific SLA/uptime number. Per the honesty rule, specific SLAs require sustained production measurement. Remove or qualify with 'target SLO' / 'designed to support'.")
  fi
fi

# ----------------------------------------------------------------------------
# Report
# ----------------------------------------------------------------------------
if [ ${#BLOCKERS[@]} -gt 0 ]; then
  echo "============================================" >&2
  echo "  STOP VALIDATION — HARD-GATE VIOLATION" >&2
  echo "============================================" >&2
  echo "" >&2
  for b in "${BLOCKERS[@]}"; do
    echo -e "  [BLOCK] $b" >&2
    echo "" >&2
  done
  echo "--------------------------------------------" >&2
  echo "Resolve every BLOCK above before stopping. To override for a documented reason, re-run with STOP_VALIDATION_WARN_ONLY=1." >&2
fi

if [ ${#WARNINGS[@]} -gt 0 ]; then
  echo "============================================"
  echo "  STOP VALIDATION — ADVISORY WARNINGS"
  echo "============================================"
  echo ""
  for w in "${WARNINGS[@]}"; do
    echo -e "  [WARN] $w"
    echo ""
  done
  echo "--------------------------------------------"
  echo "These are advisory (warn-first). Address them or document why they are intentional before considering the session complete."
fi

if [ ${#BLOCKERS[@]} -gt 0 ]; then
  exit 2
fi

exit 0
