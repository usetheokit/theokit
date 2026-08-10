#!/bin/bash
# PreToolUse hook for Bash: blocks destructive commands.
# Mirrors the universal git/safety rules from CLAUDE.md (Inquebrável Rule 4).
# Exit 0 = allow, Exit 2 = block (stderr is shown to Claude).
#
# Design note: this hook fails CLOSED. Any inability to inspect the command
# safely (missing jq, unparseable input) results in a BLOCK, never a silent
# allow. Detection is normalized so git global options cannot smuggle a
# forbidden subcommand past the guards.

set -euo pipefail

INPUT=$(cat)

# Nothing on stdin => no command to inspect => allow (there is nothing to run).
if [ -z "${INPUT//[[:space:]]/}" ]; then
  exit 0
fi

# F5: fail CLOSED if jq is unavailable. Without jq we cannot parse the command,
# and a fail-open here would let every command through.
if ! command -v jq >/dev/null 2>&1; then
  echo "BLOCKED: jq unavailable — cannot validate command safely (fail-closed)." >&2
  exit 2
fi

# F5: a parse error must never become a silent allow. jq failing (bad JSON)
# would otherwise abort the script with a non-2 exit under set -e/pipefail,
# which Claude treats as allow. Capture the failure and block explicitly.
if ! COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null); then
  echo "BLOCKED: could not parse hook input as JSON (fail-closed)." >&2
  exit 2
fi

if [ -z "$COMMAND" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# --- PERF: cheap triage before the expensive guards ---
# This hook runs on EVERY Bash tool call, and it was spending ~50 forks per run
# (27 `echo | grep`, 5 `sed`, jq, `git branch`) even for a command like `ls`.
# Each guard below can only fire when a specific literal is present in the
# command, so a native glob test — zero forks — decides upfront whether that
# guard's regexes are worth running at all.
#
# The tests are deliberately BROADER than the guards they gate: any command
# containing "git" reaches every git guard exactly as before, so a bypass would
# require smuggling `git` past a substring match on the raw command. Narrowing
# these further (e.g. requiring "git ") would trade the property that makes this
# safe — over-matching costs a few milliseconds, under-matching costs a hole.
HAS_GIT=no;  case "$COMMAND" in *git*) HAS_GIT=yes ;; esac
HAS_RM=no;   case "$COMMAND" in *rm*)  HAS_RM=yes ;; esac
HAS_ZONE=no; case "$COMMAND" in *knowledge-base/*) HAS_ZONE=yes ;; esac
HAS_PKG=no;  case "$COMMAND" in *pip*|*poetry*|*uv*|*npm*|*pnpm*|*yarn*|*cargo*|*go*) HAS_PKG=yes ;; esac

# F3: strip leading git global options so `git <globals> <subcommand>` can never
# bypass the subcommand guards. Globals normalized: -C DIR, -c K=V,
# --git-dir=..., --work-tree=..., -p, --paginate. Applied repeatedly (a git
# invocation may carry several) and to every git occurrence in a compound.
# Split a command into independently-judged segments. `$2 = with-pipe` also splits
# on `|`; omit it when the pipe itself is part of what is being detected (a pipe
# can be the export vector: `cat <file> | tee <dest>`).
# Defined at top level on purpose: the force-push guard and the study-zone export
# guard both call it, and those live under different short-circuits. Nesting it
# inside the git branch made `cat knowledge-base/tools/x | tee /out` fail open
# with "split_segments: command not found" — the export guard silently skipped.
split_segments() {
  local sep='(\|\||&&|;)'
  [ "${2:-}" = "with-pipe" ] && sep='(\|\||&&|;|\|)'
  printf '%s' "$1" | sed -E "s/$sep/\n/g"
}

strip_git_globals() {
  local cmd="$1" prev=""
  while [ "$cmd" != "$prev" ]; do
    prev="$cmd"
    cmd=$(printf '%s' "$cmd" | sed -E 's/(^|[^[:alnum:]_.])git[[:space:]]+(--git-dir=[^[:space:]]+|--work-tree=[^[:space:]]+|-[cC][[:space:]]+[^[:space:]]+|--paginate|-p)[[:space:]]+/\1git /g')
  done
  printf '%s' "$cmd"
}

# CMD is the normalized command used for all git subcommand matching.
# The normalization only ever rewrites `git ...`, so skipping it on a command
# with no `git` leaves CMD identical to COMMAND while saving the sed loop.
if [ "$HAS_GIT" = yes ]; then
  CMD=$(strip_git_globals "$COMMAND")
else
  CMD="$COMMAND"
fi

# --- Inquebrável git rules (CLAUDE.md §4) ---
if [ "$HAS_GIT" = yes ]; then
if echo "$CMD" | grep -qE 'git[[:space:]]+checkout([[:space:]]|$)'; then
  echo "BLOCKED: 'git checkout' is forbidden by Inquebrável Rule 4. Use 'git switch' or 'git restore' instead." >&2
  exit 2
fi

if echo "$CMD" | grep -qE 'git[[:space:]]+revert([[:space:]]|$)'; then
  echo "BLOCKED: 'git revert' is forbidden by Inquebrável Rule 4. Create a new commit that reverses the change explicitly." >&2
  exit 2
fi

# F2: force-push guard. The forcing token may appear ANYWHERE in the push args
# (not just right after `push`), and a leading `+` refspec (`+main`) also forces.
# `--force-with-lease` is explicitly allowed.
# F11 (#6): the token must belong to the PUSH. Previously "a push exists" and "a
# force token exists" were checked independently over the whole command, so the
# `-f` of a neighbour (`rm -f x && git push`, `tar -xf p && git push`) was read as
# a force push. The command is split on command separators and each segment is
# judged on its own, so a force token only counts inside the segment that pushes.
# Every push in a compound is inspected — checking only the first or last would
# lose `git push --force a && git push b`.
FORCE_TOKEN_RE='(--force([[:space:]]|$)|(^|[[:space:]])-[a-z]*f([[:space:]]|$)|[[:space:]]\+[^[:space:]-][^[:space:]]*)'
force_push_detected() {
  local seg
  # `|| [ -n "$seg" ]` is required: the last segment carries no trailing newline,
  # and a bare `read` would drop it — which silently skipped every single-segment
  # command (i.e. the plain `git push --force`).
  while IFS= read -r seg || [ -n "$seg" ]; do
    echo "$seg" | grep -qE 'git[[:space:]]+push([[:space:]]|$)' || continue
    echo "$seg" | grep -qE "$FORCE_TOKEN_RE" && return 0
  done < <(split_segments "$1" with-pipe)
  return 1
}

if force_push_detected "$CMD"; then
  echo "BLOCKED: force push is forbidden. Use --force-with-lease only when explicitly authorized." >&2
  exit 2
fi

if echo "$CMD" | grep -qE 'git[[:space:]]+reset[[:space:]]+--hard'; then
  echo "BLOCKED: 'git reset --hard' is forbidden. Use 'git stash' or create a branch instead." >&2
  exit 2
fi

# --- No work directly on main (CLAUDE.md §4) ---
# main receives release merges ONLY. Block every local command that mutates the
# main ref: commit, plus merge/rebase/reset/cherry-pick.
# F4: apply main-protection when EITHER the current branch is main OR the command
# text itself switches to main inline (e.g. `git switch main && git commit ...`),
# since reading the live branch alone is bypassable in a compound command.
# F9: a command may legitimately QUOTE a git invocation without running one —
# documentation, an issue body, a commit message. Matching the raw text made
# `echo "... git switch main ... git commit ..."` indistinguishable from the F4
# bypass, blocking even the act of documenting this very rule. Quoted content is
# therefore blanked before main-protection matching ONLY. Every other guard keeps
# matching the raw command on purpose: there a quoted argument (`rm -rf "$HOME"`)
# is a real target, not a citation, and blanking it would open a hole.
# Honest limit: this is not a shell parser. Nested/escaped quotes and here-docs
# are approximated; the real bypass (`git switch main && git commit`) is unquoted
# by construction, which is what F4 must keep catching.
strip_quoted() {
  printf '%s' "$1" | sed -E "s/'[^']*'//g" | sed -E 's/"[^"]*"//g'
}

BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
CMD_UNQUOTED=$(strip_quoted "$CMD")
INLINE_MAIN=no
if echo "$CMD_UNQUOTED" | grep -qE 'git[[:space:]]+switch[[:space:]]+(-[cC][[:space:]]+)?main([[:space:]]|$)' \
   || echo "$CMD_UNQUOTED" | grep -qE 'git[[:space:]]+checkout[[:space:]]+(-b[[:space:]]+)?main([[:space:]]|$)'; then
  INLINE_MAIN=yes
fi

if [ "$BRANCH" = "main" ] || [ "$INLINE_MAIN" = "yes" ]; then
  if echo "$CMD_UNQUOTED" | grep -qE 'git[[:space:]]+commit([[:space:]]|$)'; then
    echo "BLOCKED: never commit directly to main (Inquebrável Rule 4). Work on 'develop' (single-trunk)." >&2
    exit 2
  fi
  if echo "$CMD_UNQUOTED" | grep -qE 'git[[:space:]]+(merge|rebase|reset|cherry-pick)([[:space:]]|$)'; then
    echo "BLOCKED: never mutate 'main' directly (Inquebrável Rule 4). main receives release merges only, via a develop→main PR. Switch to 'workspace' first." >&2
    exit 2
  fi
fi

# --- G1: develop INTEGRATES work, it never ORIGINATES it ---
# Branching model (git-safety.md § 1): workspace → develop → main.
# Work is born on `workspace`; `develop` advances only by promoting workspace
# (via PR) and by push. Everything that would author or rewrite history on
# develop — commit, rebase, reset, cherry-pick — is blocked, exactly as on main.
# The inline form (`git switch develop && git commit`) is covered too, mirroring F4.
# Honest limit: this hook enforces the ORIGIN of the work (it must come from
# workspace). It cannot tell a merge that finalizes an approved PR from one that
# skips review — that guarantee comes from branch protection on the remote.
INLINE_DEVELOP=no
if echo "$CMD_UNQUOTED" | grep -qE 'git[[:space:]]+switch[[:space:]]+(-[cC][[:space:]]+)?develop([[:space:]]|$)' \
   || echo "$CMD_UNQUOTED" | grep -qE 'git[[:space:]]+checkout[[:space:]]+(-b[[:space:]]+)?develop([[:space:]]|$)'; then
  INLINE_DEVELOP=yes
fi

if [ "$BRANCH" = "develop" ] || [ "$INLINE_DEVELOP" = "yes" ]; then
  if echo "$CMD_UNQUOTED" | grep -qE 'git[[:space:]]+commit([[:space:]]|$)'; then
    echo "BLOCKED: never commit directly to 'develop' (git-safety.md § 1). Work is born on 'workspace' and reaches develop through a workspace→develop PR. Switch to 'workspace' first." >&2
    exit 2
  fi
  if echo "$CMD_UNQUOTED" | grep -qE 'git[[:space:]]+(rebase|reset|cherry-pick)([[:space:]]|$)'; then
    echo "BLOCKED: never rewrite 'develop' history (git-safety.md § 1). develop integrates work, it never originates it. Do the work on 'workspace' and promote it via PR." >&2
    exit 2
  fi
  # The promotion merge is the ONE mutation develop accepts — and only from workspace.
  if echo "$CMD_UNQUOTED" | grep -qE 'git[[:space:]]+merge([[:space:]]|$)'; then
    if ! echo "$CMD_UNQUOTED" | grep -qE 'git[[:space:]]+merge([[:space:]]+-[^[:space:]]+)*[[:space:]]+((origin|upstream)/)?workspace([[:space:]]|$)'; then
      echo "BLOCKED: 'develop' only accepts the promotion merge from 'workspace' (git-safety.md § 1). Merging anything else into develop bypasses the workspace→develop gate." >&2
      exit 2
    fi
  fi
fi
fi  # end HAS_GIT — every guard above matches on a literal `git`

# --- rm -rf on dangerous system paths ---
# F1: detect recursive intent in ANY flag order/spelling (-rf, -fr, -Rf, -f -r,
#     --recursive) BEFORE checking the path. Force alone cannot delete a
#     directory, so recursive intent is the destructive signal.
# F8: /home only blocks bare roots (/home, /home/<user>, /home/<user>/, $HOME, ~)
#     — legitimate deep project paths under /home are allowed. Other system dirs
#     (/etc /usr /var /bin /lib /opt /boot /root) and / stay fully blocked.
# F10: the root-glob alternative is ANCHORED to the start of an argument. Without
#     the anchor, `/\*` matched any `dir/sub/*`, so cleaning a deep directory was
#     blocked — while the hook's own message tells the operator to scope deletions
#     to deep subdirectories and /tmp/. `rm -rf /*` stays blocked (the `/` follows
#     a space).
RM_RECURSIVE_RE='(^|[[:space:]])(-[a-zA-Z]*[rR][a-zA-Z]*([[:space:]]|$)|--recursive([[:space:]]|=|$))'
RM_INVOCATION_RE='(^|[[:space:]]|;|&&|\|\||\||\()[[:space:]]*rm([[:space:]])'
DANGEROUS_PATH_RE='(/([[:space:]]|$)|(^|[[:space:]])/\*|~/?([[:space:]]|$)|\$HOME/?([[:space:]]|$)|/home([[:space:]]|$)|/home/([[:space:]]|$)|/home/[^/[:space:]]+/?([[:space:]]|$)|(/etc|/usr|/var|/bin|/lib|/opt|/boot|/root)([[:space:]]|/|$))'
if [ "$HAS_RM" = yes ] \
   && echo "$CMD" | grep -qE "$RM_INVOCATION_RE" \
   && echo "$CMD" | grep -qE "$RM_RECURSIVE_RE" \
   && echo "$CMD" | grep -qE "$DANGEROUS_PATH_RE"; then
  echo "BLOCKED: 'rm -r' on a system/home-root path. Scope recursive deletions to project-relative paths, deep project subdirectories, or /tmp/." >&2
  exit 2
fi

# --- knowledge-base/references/ and knowledge-base/tools/ are read-only study material ---
# Escape hatch: a `.references-bootstrap` marker file at project root unblocks WRITE ops
# to references/ AND tools/. Use ONLY for initial population; delete it right after.
# Both guards below require the literal `knowledge-base/` in the command, so the
# glob test skips the segment loop (one grep per segment) for everything else.
if [ "$HAS_ZONE" = yes ] && [ ! -f "$PROJECT_DIR/.references-bootstrap" ]; then
  if echo "$COMMAND" | grep -qE '(^|[[:space:]]|;|&&|\|\||\||\()[[:space:]]*((rm|mv|cp|sed[[:space:]]+-i|tee)[[:space:]]+[^;&|]*(\./)?(\.claude/)?knowledge-base/(references|tools)/|>{1,2}[[:space:]]+(\./)?(\.claude/)?knowledge-base/(references|tools)/)'; then
    echo "BLOCKED: 'knowledge-base/references/' and 'knowledge-base/tools/' are read-only study material. Capture findings in 'knowledge-base/discoveries/blueprints/'. For initial bootstrap, create '.references-bootstrap' at project root AND cite the source in CHANGELOG.md; remove the marker when done." >&2
    exit 2
  fi

  # P1: content must not leave the study zone either. The guard above only watched
  # writes INTO it; copying OUT is the provenance leak and was fully open — the
  # study material is third-party code, and a literal copy into the project carries
  # its licence with it. Reading, grepping and listing stay allowed: that is what
  # the zone is FOR. What is blocked is duplicating its bytes somewhere else.
  # Judged per segment so an unrelated `cp` elsewhere in a compound is not blamed
  # on the zone. The pipe does NOT split here — `cat <zone-file> | tee <dest>` is
  # itself an export vector.
  ZONE_RE='(\./)?(\.claude/)?knowledge-base/(references|tools)/'
  EXPORT_VERB_RE='(^|[[:space:]]|\()[[:space:]]*(cp|mv|rsync|scp|install|tar|zip|dd)([[:space:]]|$)'
  EXPORT_REDIRECT_RE='>{1,2}[[:space:]]*[^[:space:]&>]'
  EXPORT_PIPE_RE='\|[[:space:]]*(tee|dd)([[:space:]]|$)'
  while IFS= read -r seg || [ -n "$seg" ]; do
    echo "$seg" | grep -qE "$ZONE_RE" || continue
    if echo "$seg" | grep -qE "$EXPORT_VERB_RE" \
       || echo "$seg" | grep -qE "$EXPORT_REDIRECT_RE" \
       || echo "$seg" | grep -qE "$EXPORT_PIPE_RE"; then
      echo "BLOCKED: copying content OUT of 'knowledge-base/references/' or 'knowledge-base/tools/' is forbidden — that is third-party study material and a literal copy carries its licence into this project. Read it, learn from it, and write your own version; record the finding in 'knowledge-base/discoveries/blueprints/' citing the source." >&2
      exit 2
    fi
  done < <(split_segments "$COMMAND")
fi

# --- P2: commit messages must not carry reference-zone paths ---
# Citing the zone in a message is a provenance trail pointing at third-party code
# in a public history. Matches the full zone path only, so ordinary words like
# "cross-references" are untouched. `-F <file>` is read too, since that is how a
# long message is normally supplied.
if [ "$HAS_GIT" = yes ] && echo "$CMD" | grep -qE 'git[[:space:]]+commit([[:space:]]|$)'; then
  COMMIT_TEXT="$COMMAND"
  MSG_FILE=$(printf '%s' "$COMMAND" | sed -nE 's/.*(-F|--file)[[:space:]]+([^[:space:]]+).*/\2/p')
  if [ -n "$MSG_FILE" ] && [ -f "$MSG_FILE" ]; then
    COMMIT_TEXT="$COMMIT_TEXT
$(cat "$MSG_FILE" 2>/dev/null || true)"
  fi
  if echo "$COMMIT_TEXT" | grep -qE '(\./)?(\.claude/)?knowledge-base/(references|tools)/'; then
    echo "BLOCKED: the commit message cites a path under 'knowledge-base/references/' or 'knowledge-base/tools/'. That zone is third-party study material and must not be referenced in this repository's public history. Describe the behaviour you implemented, not the material you studied." >&2
    exit 2
  fi
fi

# --- No Co-Authored-By trailers in commit messages (user policy) ---
if [ "$HAS_GIT" = yes ] && echo "$CMD" | grep -qE 'git[[:space:]]+commit' && echo "$COMMAND" | grep -qiE 'co-authored-by'; then
  echo "BLOCKED: 'Co-Authored-By:' trailers are forbidden on this project's commits (user policy). Remove the trailer from the commit message body." >&2
  exit 2
fi

# --- No dependency install inside read-only references/ ---
if [ "$HAS_PKG" = yes ] \
   && echo "$COMMAND" | grep -qE '(pip|poetry|uv|npm|pnpm|yarn|cargo|go[[:space:]]+(get|mod))[[:space:]]+(install|add|tidy|download)' \
   && case "$PWD" in *knowledge-base/references/*) true ;; *) false ;; esac; then
  echo "BLOCKED: never install dependencies inside knowledge-base/references/. Those are read-only clones." >&2
  exit 2
fi

exit 0
