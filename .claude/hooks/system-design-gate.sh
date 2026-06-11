#!/bin/bash
# PostToolUse hook for Edit/Write: system design quality gate
# Validates architectural invariants on every file modification.
# Exit 0 = ok (stdout is context for Claude)

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.new_string // .tool_input.content // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only check TypeScript files in packages/
if ! echo "$FILE_PATH" | grep -qE 'packages/.*\.(ts|tsx)$'; then
  exit 0
fi

# Skip test files — different rules apply
if echo "$FILE_PATH" | grep -qE '(\.test\.|\.spec\.|/tests/|/test/|__tests__)'; then
  exit 0
fi

VIOLATIONS=""

# ── G2: SDK is the only agent runtime ──
if echo "$CONTENT" | grep -qE 'openrouter\.ai|api\.openai\.com|api\.anthropic\.com'; then
  VIOLATIONS="${VIOLATIONS}\n[G2-BLOCK] Direct LLM API URL detected. Use @theokit/sdk instead."
fi

# ── G3: No deprecated ZodTypeAny ──
if echo "$CONTENT" | grep -qE 'ZodTypeAny'; then
  VIOLATIONS="${VIOLATIONS}\n[G3-WARN] Deprecated ZodTypeAny found. Use z.ZodType instead."
fi

# ── G3: No 'any' in production code ──
if echo "$CONTENT" | grep -qE ':\s*any\b|<any>|as\s+any\b'; then
  VIOLATIONS="${VIOLATIONS}\n[G3-WARN] 'any' type detected in production code. Use proper typing or 'unknown'."
fi

# ── G3: No @ts-ignore ──
if echo "$CONTENT" | grep -qE '@ts-ignore|@ts-expect-error'; then
  VIOLATIONS="${VIOLATIONS}\n[G3-BLOCK] @ts-ignore/@ts-expect-error is forbidden in production code."
fi

# ── G8: No Math.random for IDs ──
if echo "$CONTENT" | grep -qE 'Math\.random\(\)'; then
  if echo "$FILE_PATH" | grep -qvE '/tests/|\.test\.'; then
    VIOLATIONS="${VIOLATIONS}\n[G8-WARN] Math.random() detected. Use crypto.randomUUID() for identifiers."
  fi
fi

# ── G8: No axios in core packages ──
if echo "$CONTENT" | grep -qE "from\s+['\"]axios['\"]|require\(['\"]axios['\"]"; then
  VIOLATIONS="${VIOLATIONS}\n[G8-WARN] axios import detected. Use fetch() (Web Standard) instead."
fi

# ── G9: No console.log in production ──
if echo "$CONTENT" | grep -qE 'console\.(log|debug|info)\('; then
  if echo "$FILE_PATH" | grep -qvE 'cli/|create-theokit/'; then
    VIOLATIONS="${VIOLATIONS}\n[G9-WARN] console.log/debug/info in production code. Use console.warn/error or structured logging."
  fi
fi

# ── G1: Cross-package dependency direction ──
# agents must not import theokit core
if echo "$FILE_PATH" | grep -qE 'packages/agents/'; then
  if echo "$CONTENT" | grep -qE "from\s+['\"]theokit[/'\"]"; then
    VIOLATIONS="${VIOLATIONS}\n[G1-BLOCK] @theokit/agents must not import from theokit core. Use @theokit/http only."
  fi
fi

# http must not import agents
if echo "$FILE_PATH" | grep -qE 'packages/http/'; then
  if echo "$CONTENT" | grep -qE "from\s+['\"]@theokit/agents['\"]"; then
    VIOLATIONS="${VIOLATIONS}\n[G1-BLOCK] @theokit/http must not import from @theokit/agents. Dependency flows the other way."
  fi
fi

# create-theokit must not import runtime packages
if echo "$FILE_PATH" | grep -qE 'packages/create-theokit/'; then
  if echo "$CONTENT" | grep -qE "from\s+['\"](@theokit/|theokit[/'\"])"; then
    VIOLATIONS="${VIOLATIONS}\n[G1-BLOCK] create-theokit must not import @theokit/* runtime packages."
  fi
fi

# ── Report ──
if [ -n "$VIOLATIONS" ]; then
  echo -e "System Design Gate violations detected:${VIOLATIONS}"
  echo ""
  echo "Reference: .claude/rules/system-design-guardrails.md"
fi

exit 0
