#!/bin/bash
# Shared ecosystem layout detection for hooks.
#
# Source this file from any hook:
#   source "$(dirname "$0")/lib/detect-layout.sh"
#
# After sourcing, $ECO is set to:
#   ".claude"  — plugin install layout
#   "."        — standalone layout
#   (exits 0 if no ecosystem found — hook should not act)
#
# $PROJECT_DIR is also set (defaults to $CLAUDE_PROJECT_DIR or pwd).

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0

if [ -d ".claude/skills" ] && [ -d ".claude/rules" ] && [ -d ".claude/hooks" ]; then
  ECO=".claude"
elif [ -d "skills" ] && [ -d "rules" ] && [ -d "hooks" ]; then
  ECO="."
else
  exit 0
fi
