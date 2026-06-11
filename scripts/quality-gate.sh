#!/bin/bash
# Quality Gate — runs before commit to enforce system design invariants
# Called by lint-staged or manually via: bash scripts/quality-gate.sh
# Exit 0 = all gates pass, Exit 1 = at least one BLOCK

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

PASS=0
WARN=0
FAIL=0

check() {
  local name="$1"
  local cmd="$2"
  local level="${3:-BLOCK}"

  if eval "$cmd" > /dev/null 2>&1; then
    echo -e "  ${GREEN}PASS${NC}  $name"
    PASS=$((PASS + 1))
  else
    if [ "$level" = "WARN" ]; then
      echo -e "  ${YELLOW}WARN${NC}  $name"
      WARN=$((WARN + 1))
    else
      echo -e "  ${RED}FAIL${NC}  $name"
      FAIL=$((FAIL + 1))
    fi
  fi
}

echo "TheoKit Quality Gate"
echo "===================="
echo ""

# G2: No direct LLM API calls
echo "G2 — SDK Runtime Rule"
# Check agents + http only (theo core has provider config URLs — that's allowed)
check "No LLM API URLs in @theokit/agents" \
  "! grep -rn 'openrouter\.ai\|api\.openai\.com\|api\.anthropic\.com' packages/agents/src/ --include='*.ts' -q"
check "No LLM API URLs in @theokit/http" \
  "! grep -rn 'openrouter\.ai\|api\.openai\.com\|api\.anthropic\.com' packages/http/src/ --include='*.ts' -q"

# G3: Type safety
echo ""
echo "G3 — Type Safety"
check "No deprecated ZodTypeAny" \
  "! grep -rn 'ZodTypeAny' packages/*/src/ --include='*.ts' -q" "WARN"
check "No @ts-ignore in production" \
  "! grep -rn '@ts-ignore' packages/*/src/ --include='*.ts' -q"

# G6: File size
echo ""
echo "G6 — File Size Budget"
OVERSIZED=$(find packages/*/src/ -name '*.ts' -o -name '*.tsx' | while read f; do
  lines=$(grep -cv '^\s*$\|^\s*//' "$f" 2>/dev/null || echo 0)
  if [ "$lines" -gt 500 ]; then
    echo "$f ($lines LoC)"
  fi
done)
if [ -z "$OVERSIZED" ]; then
  echo -e "  ${GREEN}PASS${NC}  All files under 500 LoC"
  PASS=$((PASS + 1))
else
  echo -e "  ${YELLOW}WARN${NC}  Files over 500 LoC:"
  echo "$OVERSIZED" | while read line; do echo "         $line"; done
  WARN=$((WARN + 1))
fi

# G8: Web Standards
echo ""
echo "G8 — Web Standards"
check "No Math.random in production" \
  "! grep -rn 'Math\.random()' packages/*/src/ --include='*.ts' --exclude-dir=tests -q" "WARN"

# Lint + Type gates
echo ""
echo "Quality Gates"
check "ESLint @theokit/http" \
  "npx eslint packages/http/src --max-warnings=0 2>/dev/null"
check "ESLint @theokit/agents" \
  "npx eslint packages/agents/src --max-warnings=0 2>/dev/null"
check "TypeScript @theokit/http" \
  "npx tsc --noEmit -p packages/http/tsconfig.json 2>/dev/null"
check "TypeScript @theokit/agents" \
  "npx tsc --noEmit -p packages/agents/tsconfig.test.json 2>/dev/null"

# Summary
echo ""
echo "===================="
echo -e "Results: ${GREEN}${PASS} PASS${NC}, ${YELLOW}${WARN} WARN${NC}, ${RED}${FAIL} FAIL${NC}"

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}Quality gate FAILED. Fix BLOCK findings before commit.${NC}"
  exit 1
fi

if [ "$WARN" -gt 0 ]; then
  echo -e "${YELLOW}Quality gate PASSED with warnings. Review before shipping.${NC}"
fi

exit 0
