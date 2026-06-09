#!/bin/bash
# StatusLine — emits a single line shown in Claude Code's status bar.
#
# Composition: <git-branch[*=dirty]> | <plan-slug> | <ralph-loop:iter or ->
#
# Outputs nothing if not in a git repo (Claude Code falls back to default).

set -eu

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" 2>/dev/null || exit 0

PARTS=""

# Git
if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  BRANCH=$(git branch --show-current 2>/dev/null || echo "?")
  DIRTY=""
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    DIRTY="*"
  fi
  PARTS="$BRANCH$DIRTY"
fi

# Plan
PLAN=""
if [ -f .active_plan ]; then
  PLAN=$(tr -d '\r\n[:space:]' < .active_plan 2>/dev/null)
fi
if [ -z "$PLAN" ] && [ -d knowledge-base/plans ]; then
  NEWEST=$(ls -t knowledge-base/plans/*-plan.md 2>/dev/null | head -1)
  [ -n "$NEWEST" ] && PLAN=$(basename "$NEWEST" -plan.md)
fi
if [ -n "$PLAN" ]; then
  PARTS="${PARTS:+$PARTS | }plan:$PLAN"
fi

# Ralph-loop
if [ -f ralph-loop.local.md ]; then
  ACTIVE=$(grep '^active:' ralph-loop.local.md 2>/dev/null | sed 's/active: *//' | tr -d ' ')
  if [ "$ACTIVE" = "true" ]; then
    ITER=$(grep '^iteration:' ralph-loop.local.md 2>/dev/null | sed 's/iteration: *//' | tr -d ' ')
    PARTS="${PARTS:+$PARTS | }loop:iter$ITER"
  fi
fi

printf '%s' "$PARTS"
