#!/bin/bash
# PreToolUse hook for Bash: blocks destructive commands.
# Mirrors the universal git/safety rules from CLAUDE.md (Inquebrável Rule 4).
# Exit 0 = allow, Exit 2 = block (stderr is shown to Claude).

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# --- Inquebrável git rules (CLAUDE.md §4) ---
if echo "$COMMAND" | grep -qE 'git[[:space:]]+checkout([[:space:]]|$)'; then
  echo "BLOCKED: 'git checkout' is forbidden by Inquebrável Rule 4. Use 'git switch' or 'git restore' instead." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE 'git[[:space:]]+revert([[:space:]]|$)'; then
  echo "BLOCKED: 'git revert' is forbidden by Inquebrável Rule 4. Create a new commit that reverses the change explicitly." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE 'git[[:space:]]+push[[:space:]]+(-f([[:space:]]|$)|--force([[:space:]]|$))'; then
  echo "BLOCKED: force push is forbidden. Use --force-with-lease only when explicitly authorized." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE 'git[[:space:]]+reset[[:space:]]+--hard'; then
  echo "BLOCKED: 'git reset --hard' is forbidden. Use 'git stash' or create a branch instead." >&2
  exit 2
fi

# --- No work directly on main (CLAUDE.md §4) ---
# main receives release merges ONLY, via PR. Block every local command that
# mutates the main ref: commit, plus merge/rebase/reset/cherry-pick. (push is not
# blocked here — release legitimately pushes tags; `push --force` is already
# blocked globally above for every branch.)
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
if [ "$BRANCH" = "main" ]; then
  if echo "$COMMAND" | grep -qE 'git[[:space:]]+commit([[:space:]]|$)'; then
    echo "BLOCKED: never commit directly to main (Inquebrável Rule 4). Work on 'develop' (single-trunk) or a feature branch." >&2
    exit 2
  fi
  if echo "$COMMAND" | grep -qE 'git[[:space:]]+(merge|rebase|reset|cherry-pick)([[:space:]]|$)'; then
    echo "BLOCKED: never mutate 'main' directly (Inquebrável Rule 4). main receives release merges only, via a develop→main PR. Switch to 'develop' first." >&2
    exit 2
  fi
fi

# --- rm -rf on dangerous system paths ---
if echo "$COMMAND" | grep -qE 'rm[[:space:]]+-rf?[[:space:]]+(/[[:space:]]*$|/[[:space:]]|/\*|~[[:space:]]*$|~[[:space:]]|\$HOME|/home([[:space:]]|/|$)|/etc([[:space:]]|/|$)|/usr([[:space:]]|/|$)|/var([[:space:]]|/|$)|/bin([[:space:]]|/|$)|/lib([[:space:]]|/|$)|/opt([[:space:]]|/|$)|/boot([[:space:]]|/|$)|/root([[:space:]]|/|$))'; then
  echo "BLOCKED: 'rm -rf' on a system path. Scope deletions to project-relative paths or /tmp/." >&2
  exit 2
fi

# --- knowledge-base/references/ and knowledge-base/tools/ are read-only study material ---
# Only block clear WRITE/MODIFY operations targeting these dirs.
# Read-only ops (test, ls, cat, head, tail, find, grep, for-loops, Read/Glob tools)
# are explicitly allowed — they are needed for discovery skills.
#
# Anchor the verb to a shell-segment boundary (start, space, `;`, `&&`, `||`, `|`, `(`)
# so substrings like "cp" inside "docker-compose" don't false-positive.
#
# Escape hatch: presence of a `.references-bootstrap` marker file at project root unblocks
# WRITE ops to references/ AND tools/. Use ONLY for initial population
# (git clone, bootstrap mv from another location). After the bootstrap,
# DELETE the marker — leaving it in place defeats the read-only invariant.
# Audit trail: every bootstrap MUST cite the source in CHANGELOG.md under Added/Changed.
if [ ! -f "$PROJECT_DIR/.references-bootstrap" ]; then
  # Matches both standalone (knowledge-base/) and plugin install (.claude/knowledge-base/) layouts.
  if echo "$COMMAND" | grep -qE '(^|[[:space:]]|;|&&|\|\||\||\()[[:space:]]*((rm|mv|cp|sed[[:space:]]+-i|tee)[[:space:]]+[^;&|]*(\./)?(\.claude/)?knowledge-base/(references|tools)/|>{1,2}[[:space:]]+(\./)?(\.claude/)?knowledge-base/(references|tools)/)'; then
    echo "BLOCKED: 'knowledge-base/references/' and 'knowledge-base/tools/' are read-only study material. Never modify/delete/rename anything there. Capture findings in 'knowledge-base/discoveries/blueprints/'. For initial bootstrap (git clone, mv from elsewhere), create '.references-bootstrap' at project root (with rationale inside) AND cite the source in CHANGELOG.md; remove the marker as soon as you're done." >&2
    exit 2
  fi
fi

# --- No Co-Authored-By trailers in commit messages (user policy) ---
# Blocks any `git commit` whose message body contains the literal "Co-Authored-By"
# (case-insensitive). Workaround for false-positive on legitimate documentation
# of this policy: use `git commit -F /tmp/msg` with the trailer in the file.
if echo "$COMMAND" | grep -qE 'git[[:space:]]+commit' && echo "$COMMAND" | grep -qiE 'co-authored-by'; then
  echo "BLOCKED: 'Co-Authored-By:' trailers are forbidden on this project's commits (user policy). Remove the trailer from the commit message body." >&2
  exit 2
fi

# --- No dependency install inside read-only references/ ---
# Matches both standalone (knowledge-base/) and plugin install (.claude/knowledge-base/) layouts.
if echo "$COMMAND" | grep -qE '(pip|poetry|uv|npm|pnpm|yarn|cargo|go[[:space:]]+(get|mod))[[:space:]]+(install|add|tidy|download)' && pwd | grep -qE '(\.claude/)?knowledge-base/references/'; then
  echo "BLOCKED: never install dependencies inside knowledge-base/references/. Those are read-only clones." >&2
  exit 2
fi

exit 0
