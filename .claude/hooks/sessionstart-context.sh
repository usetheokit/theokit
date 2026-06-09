#!/bin/bash
# SessionStart hook — injects dynamic project context at session start.
#
# Triggered by Claude Code at: new session, resume, /clear, post-compaction.
# Emits canonical JSON with hookSpecificOutput.additionalContext per
# https://code.claude.com/docs/en/hooks.md (Claude Code 2026).
#
# Surfaces:
#   - Current git branch + working-tree status (clean / dirty)
#   - Active plan slug (from .active_plan or fallback to newest)
#   - Active ralph-loop state (if ralph-loop.local.md present and active)
#   - Reminder of unbreakable principles

set -eu

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0

# Detect ecosystem layout: standalone (./) or plugin install (./.claude/)
if [ -d ".claude/skills" ] && [ -d ".claude/rules" ] && [ -d ".claude/hooks" ]; then
  ECO=".claude"
elif [ -d "skills" ] && [ -d "rules" ] && [ -d "hooks" ]; then
  ECO="."
else
  exit 0
fi

CTX=""
add() { CTX="$CTX$1
"; }

# 1) Git state
if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  BRANCH=$(git branch --show-current 2>/dev/null || echo "(detached)")
  STATUS=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  AHEAD=$(git rev-list --count "@{upstream}..HEAD" 2>/dev/null || echo "0")
  if [ "$STATUS" -eq 0 ]; then
    add "Git: branch=$BRANCH (clean, $AHEAD ahead of upstream)"
  else
    add "Git: branch=$BRANCH ($STATUS uncommitted files, $AHEAD ahead of upstream)"
  fi
fi

# 2) Active plan
PLAN_SLUG=""
if [ -f "$ECO/.active_plan" ]; then
  AP=$(tr -d '\r\n[:space:]' < "$ECO/.active_plan" 2>/dev/null)
  if [ -n "$AP" ] && [ -f "$ECO/knowledge-base/plans/${AP}-plan.md" ]; then
    PLAN_SLUG="$AP"
    add "Active plan: $AP ($ECO/knowledge-base/plans/${AP}-plan.md) — pinned via $ECO/.active_plan"
  fi
fi
if [ -z "$PLAN_SLUG" ] && [ -d "$ECO/knowledge-base/plans" ]; then
  NEWEST=$(ls -t "$ECO"/knowledge-base/plans/*-plan.md 2>/dev/null | head -1)
  if [ -n "$NEWEST" ]; then
    PLAN_SLUG=$(basename "$NEWEST" -plan.md)
    add "Active plan: $PLAN_SLUG (resolved by mtime — set $ECO/.active_plan to pin)"
  fi
fi

# 3) Ralph-loop state
if [ -f "$ECO/ralph-loop.local.md" ]; then
  ACTIVE=$(grep '^active:' "$ECO/ralph-loop.local.md" 2>/dev/null | sed 's/active: *//' | tr -d ' ')
  ITER=$(grep '^iteration:' "$ECO/ralph-loop.local.md" 2>/dev/null | sed 's/iteration: *//' | tr -d ' ')
  if [ "$ACTIVE" = "true" ]; then
    add "ralph-loop: ACTIVE (iter $ITER) — if stale (>24h, no progress), cancel via /ralph-loop:cancel-ralph or delete the file"
  fi
fi

# 4) Reminder
add ""
add "Unbreakable principles apply (see /home/paulo/.claude/CLAUDE.md): 95% confidence, TDD-first, no commits to main, CHANGELOG discipline."

# Exit silently if nothing relevant
if [ -z "$CTX" ]; then
  exit 0
fi

CTX_JSON=$(printf '%s' "$CTX" | jq -Rs .)
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' "$CTX_JSON"
exit 0
