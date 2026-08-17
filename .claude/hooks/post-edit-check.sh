#!/bin/bash
# PostToolUse hook for Edit/Write: language-agnostic quick feedback after a change.
#
# Behavior: detect the edited file's language by extension and surface output
# from the most universally-available linter for that language IF the toolchain
# is detected (project marker file present + tool on PATH). All steps are no-op
# when the toolchain isn't present.
#
# Supported:
#   .go   → go vet (requires go.mod) + gofmt diff
#   .py   → ruff check (requires pyproject.toml or setup.py/setup.cfg)
#   .ts/.tsx/.js/.jsx → tsc --noEmit (requires tsconfig.json) — best-effort
#   .rs   → cargo check (requires Cargo.toml) — only on the package, advisory
#
# Never blocks — output is advisory.

set -uo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
cd "$PROJECT_DIR"

ABS_FILE_PATH="$FILE_PATH"
case "$FILE_PATH" in
  /*) ABS_FILE_PATH="$FILE_PATH" ;;
  *) ABS_FILE_PATH="$PROJECT_DIR/$FILE_PATH" ;;
esac
PKG_DIR=$(dirname "$ABS_FILE_PATH")

case "$FILE_PATH" in
  *.go)
    if [ -f go.mod ] && command -v go >/dev/null 2>&1; then
      VET_OUTPUT=$(go vet "$PKG_DIR/..." 2>&1 || true)
      if [ -n "$VET_OUTPUT" ]; then
        echo "go vet warnings on $PKG_DIR — first 8 lines:"
        echo "$VET_OUTPUT" | head -8
        echo ""
      fi
      if command -v gofmt >/dev/null 2>&1 && [ -f "$ABS_FILE_PATH" ]; then
        FMT_DIFF=$(gofmt -d "$ABS_FILE_PATH" 2>/dev/null || true)
        if [ -n "$FMT_DIFF" ]; then
          echo "gofmt would reformat $FILE_PATH — first 12 diff lines:"
          echo "$FMT_DIFF" | head -12
          echo ""
          echo "Run 'gofmt -w $FILE_PATH' to apply."
        fi
      fi
    fi
    ;;
  *.py)
    if { [ -f pyproject.toml ] || [ -f setup.py ] || [ -f setup.cfg ]; } && command -v ruff >/dev/null 2>&1; then
      RUFF_OUTPUT=$(ruff check "$ABS_FILE_PATH" 2>&1 || true)
      if [ -n "$RUFF_OUTPUT" ]; then
        echo "ruff warnings on $FILE_PATH — first 8 lines:"
        echo "$RUFF_OUTPUT" | head -8
      fi
    fi
    ;;
  *.ts|*.tsx|*.js|*.jsx)
    if [ -f tsconfig.json ] && command -v npx >/dev/null 2>&1; then
      # Best-effort: only run if tsc is locally installed (avoid network resolves)
      if [ -x node_modules/.bin/tsc ]; then
        TSC_OUTPUT=$(node_modules/.bin/tsc --noEmit -p tsconfig.json 2>&1 | head -12 || true)
        if [ -n "$TSC_OUTPUT" ]; then
          echo "tsc warnings — first 12 lines:"
          echo "$TSC_OUTPUT"
        fi
      fi
    fi
    ;;
  *.rs)
    if [ -f Cargo.toml ] && command -v cargo >/dev/null 2>&1; then
      CARGO_OUTPUT=$(cargo check --message-format=short 2>&1 | head -12 || true)
      if [ -n "$CARGO_OUTPUT" ]; then
        echo "cargo check — first 12 lines:"
        echo "$CARGO_OUTPUT"
      fi
    fi
    ;;
esac

exit 0
