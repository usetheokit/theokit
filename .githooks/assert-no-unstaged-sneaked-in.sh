#!/usr/bin/env bash
# Refuse a commit that grew paths nobody staged.
#
# Split out of `pre-commit` so it can be tested. A gate that only runs inside a git hook
# is a gate nobody exercises until the day it matters, and this one exists precisely
# because the last silent failure was caught by a human reading `git show --stat`.
#
# Usage: assert-no-unstaged-sneaked-in.sh <before-file> <after-file>
#   Each file holds one path per line, sorted — the output of `git diff --cached
#   --name-only | sort` taken before and after the lint/format gate.
#
# Exit 0 when the staged set stayed equal or SHRANK; exit 1 when it GREW, printing the
# paths that appeared. Shrinking is legitimate (a formatter can leave a file unchanged);
# growing never is, because lint-staged may rewrite what the author staged and has no
# business adding what they did not.
set -euo pipefail

BEFORE="${1:?usage: $0 <before-file> <after-file>}"
AFTER="${2:?usage: $0 <before-file> <after-file>}"

SNEAKED_IN="$(comm -13 "$BEFORE" "$AFTER")"
[ -z "$SNEAKED_IN" ] && exit 0

cat >&2 <<MSG

✗ The commit grew paths you never staged.

  These entered the index while the lint/format gate ran:

$(printf '%s\n' "$SNEAKED_IN" | sed 's/^/    /')

  This is usetheokit/theokit#378: a partially staged file makes lint-staged restore the
  whole working tree into the index. Committing now would carry unfinished work — and on
  a shared checkout, somebody else's.

  To recover: \`git reset\` the paths above, then commit again with a clean index.
  Staging your hunks with \`git stash push --keep-index\` first avoids the trigger.

MSG
exit 1
