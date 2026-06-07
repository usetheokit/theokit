#!/bin/bash
# PostToolUse hook for Edit/Write: lints PUBLIC COPY for unverifiable claims.
#
# Scope (per rules/public-copy.md):
#   - README.md (any directory)
#   - PITCH.md
#   - docs/marketing/**/*.md
#   - docs/guides/**/*.md
#
# Does NOT apply to:
#   - docs/exploration-reports/*.md
#   - docs/benchmarks/*.md
#   - docs/adr/*.md
#   - CLAUDE.md, PRD.md, CHANGELOG.md, source code
#   - knowledge-base/references/** (already blocked by boundary-check)
#
# Universal banned terms (agnostic — no product/competitor names hardcoded):
#   - production-ready / production-grade / battle-tested / enterprise-(ready|grade)
#       → pre-release until measured evidence sustains the claim
#   - "Faster than <X>" without a benchmark artifact in the same paragraph
#       → comparative perf requires docs/benchmarks/ with independent reproduction
#   - "Drop-in replacement"
#       → implies zero migration cost; almost always false
#   - "Zero downtime" (unqualified)
#       → requires an explicit "minor" / "rolling" qualifier nearby
#   - "Lock-in free" / "Lock-in proof"
#       → exaggeration; use a specific affirmation
#   - "<X> killer" framing
#       → use outcome-shaped positioning, not vendor-hostile
#   - Specific SLA numbers (99.9% / 99.95% / 99.99%) without
#     "designed to" / "target" / "aspirational" qualifier
#       → requires sustained measurement in real production
#
# Exit 0 always — output is advisory (warn-first).

set -uo pipefail

# Detect ecosystem layout: standalone (./) or plugin install (./.claude/)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
if [ -d "$PROJECT_DIR/.claude/rules" ]; then
  ECO=".claude"
else
  ECO="."
fi

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Public copy scope only
IS_PUBLIC_COPY=false
case "$FILE_PATH" in
  */README.md|README.md) IS_PUBLIC_COPY=true ;;
  */PITCH.md|PITCH.md) IS_PUBLIC_COPY=true ;;
  *docs/marketing/*.md) IS_PUBLIC_COPY=true ;;
  *docs/guides/*.md) IS_PUBLIC_COPY=true ;;
  *) IS_PUBLIC_COPY=false ;;
esac

if [ "$IS_PUBLIC_COPY" = false ]; then
  exit 0
fi

# Skip technical docs even if they live under docs/
case "$FILE_PATH" in
  *docs/exploration-reports/*) exit 0 ;;
  *docs/benchmarks/*) exit 0 ;;
  *docs/adr/*) exit 0 ;;
esac

CONTENT=$(echo "$INPUT" | jq -r '.tool_input.new_string // .tool_input.content // empty')

if [ -z "$CONTENT" ]; then
  exit 0
fi

WARNINGS=()

# --- 1. Pre-release honesty ---
if echo "$CONTENT" | grep -qiE 'production[[:space:]]?-?[[:space:]]?(ready|grade)'; then
  WARNINGS+=("'production-ready' or 'production-grade' in public copy. Until you have sustained measured evidence, prefer 'designed for' / 'targeted at' framings ($ECO/rules/public-copy.md).")
fi

if echo "$CONTENT" | grep -qiE '\bbattle[[:space:]]?-?[[:space:]]?tested\b'; then
  WARNINGS+=("'battle-tested' in public copy. Banned until v1.0 with sustained production usage. Use 'designed for' or 'targeted at'.")
fi

if echo "$CONTENT" | grep -qiE '\benterprise[[:space:]]?-?[[:space:]]?(ready|grade)\b'; then
  WARNINGS+=("'enterprise-ready' / 'enterprise-grade' in public copy — vague. Replace with the specific affirmation you actually mean (RBAC via OIDC, audit log retention, compliance roadmap, etc.).")
fi

# --- 2. Comparative claims without benchmark ---
if echo "$CONTENT" | grep -qiE '\bfaster[[:space:]]+than\b'; then
  if ! echo "$CONTENT" | grep -qE '(docs/benchmarks/|benchmarks/)'; then
    WARNINGS+=("'Faster than <X>' claim in public copy without a docs/benchmarks/ link in the same paragraph. Comparative performance requires a reproducible artifact + independent reproduction.")
  fi
fi

if echo "$CONTENT" | grep -qiE '\b[A-Z][A-Za-z0-9 ]+[[:space:]]+killer\b'; then
  WARNINGS+=("'<X> killer' framing in public copy. Prefer outcome-shaped positioning, not vendor-hostile framing.")
fi

if echo "$CONTENT" | grep -qiE '\bdrop[[:space:]]?-?[[:space:]]?in[[:space:]]+replacement\b'; then
  WARNINGS+=("'Drop-in replacement' in public copy implies zero migration cost — almost always false. Replace with the specific compatibility surface you actually offer.")
fi

# --- 3. Unqualified zero-downtime ---
if echo "$CONTENT" | grep -qiE '\bzero[[:space:]]?-?[[:space:]]?downtime\b'; then
  if ! echo "$CONTENT" | grep -qiE '(minor|rolling|patch|hot)[[:space:]]+[A-Za-z]*[[:space:]]?(version|upgrade|update|deploy)?[[:space:]]*(are[[:space:]]+)?zero[[:space:]]?-?[[:space:]]?downtime'; then
    WARNINGS+=("'Zero downtime' (unqualified) in public copy. Qualify the scope ('minor upgrades are zero-downtime; major upgrades have measured downtime') or remove.")
  fi
fi

# --- 4. Lock-in absolutism ---
if echo "$CONTENT" | grep -qiE '\block[[:space:]]?-?[[:space:]]?in[[:space:]]+(free|proof)\b'; then
  WARNINGS+=("'Lock-in free/proof' in public copy — exaggeration. State the specific exit affordance ('export with <tool>', 'data is yours in standard format X').")
fi

# --- 5. Specific SLA without qualifier ---
if echo "$CONTENT" | grep -qiE '\b(99\.9|99\.95|99\.99)[[:space:]]?%[[:space:]]+(uptime|SLA|SLO|availability)\b'; then
  if ! echo "$CONTENT" | grep -qiE '(designed[[:space:]]+to|target(ed)?[[:space:]]+(SLO|SLA)?|aspirational)[^.]{0,80}(99\.9|99\.95|99\.99)'; then
    WARNINGS+=("Specific SLA/uptime number (99.9% / 99.95% / 99.99%) in public copy without 'designed to' / 'target' / 'aspirational' qualifier. Specific SLAs require sustained production measurement.")
  fi
fi

if [ ${#WARNINGS[@]} -gt 0 ]; then
  echo "Public copy lint — advisory warnings on $FILE_PATH:"
  echo ""
  for w in "${WARNINGS[@]}"; do
    echo "  [WARN] $w"
    echo ""
  done
  echo "Reference: $ECO/rules/public-copy.md."
fi

exit 0
