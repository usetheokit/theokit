#!/bin/bash
# PreCompact hook — preserves plan + progress state before context compaction.
#
# Snapshots active plan excerpt + recent progress entries to a recoverable
# location so post-compaction context can be rebuilt (e.g., via session-catchup).
#
# Fires on Claude Code's PreCompact event. Outputs informational messages to the
# agent for inclusion in the compacted summary.

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

echo "[precompact-preserve] Context compaction about to occur. Preserving state."

# 1) Resolve active plan
ACTIVE_PLAN=""
if [ -f "$ECO/.active_plan" ]; then
  AP=$(tr -d '\r\n[:space:]' < "$ECO/.active_plan" 2>/dev/null)
  if [ -n "$AP" ] && [ -f "$ECO/knowledge-base/plans/$AP-plan.md" ]; then
    ACTIVE_PLAN="$ECO/knowledge-base/plans/$AP-plan.md"
  fi
fi

# Fallback: newest plan file
if [ -z "$ACTIVE_PLAN" ] && [ -d "$ECO/knowledge-base/plans" ]; then
  # shellcheck disable=SC2012
  NEWEST=$(ls -t "$ECO"/knowledge-base/plans/*-plan.md 2>/dev/null | head -1)
  [ -n "$NEWEST" ] && ACTIVE_PLAN="$NEWEST"
fi

# 2) Surface plan excerpt + snapshot
if [ -n "$ACTIVE_PLAN" ] && [ -f "$ACTIVE_PLAN" ]; then
  STATE_DIR="$ECO/.compaction-snapshots"
  mkdir -p "$STATE_DIR" 2>/dev/null
  TS=$(date -u +"%Y%m%dT%H%M%SZ")
  SNAP="$STATE_DIR/plan-$TS.md"
  cp "$ACTIVE_PLAN" "$SNAP" 2>/dev/null && \
    echo "[precompact-preserve] Plan snapshotted: $SNAP"

  echo "[precompact-preserve] Active plan: $ACTIVE_PLAN"
  echo "[precompact-preserve] Plan Goal (first blockquote line after ## Goal):"
  awk '
    /^## Goal/{ flag=1; next }
    flag && /^> /{ print; exit }
    flag && /^## /{ exit }
  ' "$ACTIVE_PLAN" 2>/dev/null
fi

# 3) Tail recent progress entries (if progress.md convention is in use)
PLAN_SLUG=""
if [ -n "$ACTIVE_PLAN" ]; then
  PLAN_SLUG=$(basename "$ACTIVE_PLAN" -plan.md)
fi
PROGRESS_FILE="$ECO/knowledge-base/progress/${PLAN_SLUG}-progress.md"
if [ -n "$PLAN_SLUG" ] && [ -f "$PROGRESS_FILE" ]; then
  echo "[precompact-preserve] Last 10 progress entries:"
  tail -10 "$PROGRESS_FILE" 2>/dev/null | sed 's/^/  /'
fi

# 4) Reminder to agent
echo ""
echo "[precompact-preserve] Post-compaction: plan + progress are on disk under $ECO/.compaction-snapshots/."
echo "[precompact-preserve] Re-read $ECO/knowledge-base/plans/ and $ECO/knowledge-base/progress/ to rebuild context."

exit 0
