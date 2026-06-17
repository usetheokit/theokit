#!/usr/bin/env bash
#
# prevent-secrets.sh — fail-fast secret scanner (GATE 1 of .githooks/pre-commit
# AND the "Secret scan" job in .github/workflows/ci.yml).
#
# Contract:
#   - Invoked with NO arguments. Scans git-tracked text files only (so
#     node_modules/, dist/, and gitignored files like .npmrc are never read).
#   - Exit 0 when clean; exit 1 (with the offending file:line) when a
#     high-confidence secret is found. `set -e` in the pre-commit hook + the CI
#     step both abort on non-zero.
#
# Design: HIGH-CONFIDENCE patterns only (real token prefixes with exact shapes,
# private-key headers, embedded DB credentials). This deliberately avoids the
# generic `(api_key|secret|token)\s*=\s*"..."` heuristic, which false-positives
# on this repo's fixtures/docs/tests. A line containing `pragma: allowlist secret`
# is skipped (inline allowlist for legitimate sample values).
#
# To add a pattern: append to PATTERNS. To exempt a specific line: add the
# trailing comment `pragma: allowlist secret` on that line.

set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 2

# High-confidence secret regexes (ERE). Each rarely appears as a fake.
PATTERNS=(
  '-----BEGIN ([A-Z]+ )?PRIVATE KEY-----'          # PEM private keys
  'npm_[A-Za-z0-9]{36}'                            # npm automation/publish token
  'ghp_[A-Za-z0-9]{36}'                            # GitHub personal access token
  'gho_[A-Za-z0-9]{36}'                            # GitHub OAuth token
  'ghs_[A-Za-z0-9]{36}'                            # GitHub server-to-server token
  'ghr_[A-Za-z0-9]{36}'                            # GitHub refresh token
  'github_pat_[A-Za-z0-9_]{60,}'                   # GitHub fine-grained PAT
  'AKIA[0-9A-Z]{16}'                               # AWS access key id
  'ASIA[0-9A-Z]{16}'                               # AWS temporary access key id
  'sk_live_[A-Za-z0-9]{20,}'                       # Stripe live secret key
  'rk_live_[A-Za-z0-9]{20,}'                       # Stripe live restricted key
  'xox[abprs]-[A-Za-z0-9-]{10,}'                   # Slack token
  'AIza[0-9A-Za-z_-]{35}'                          # Google API key
  'glpat-[A-Za-z0-9_-]{20,}'                       # GitLab personal access token
  '(postgres|postgresql)://[^[:space:]:/@]+:[^[:space:]:/@$]+@[^[:space:]/]+'  # DB URL w/ inline creds
)

# Placeholder passwords that the postgres-URL pattern must NOT flag (CI service
# container default creds + obvious sample values).
PG_PLACEHOLDERS='(postgres|postgresql)://(postgres:postgres|user:pass(word)?|root:root|admin:admin)@'

FOUND=0

# Single-pass scan: join all patterns with ERE alternation and let `git grep`
# search every tracked text file at once (fast; -I skips binaries, and tracked-
# only means node_modules/dist/.npmrc are never read). Output: file:line:content.
COMBINED="$(IFS='|'; printf '%s' "${PATTERNS[*]}")"

# Run git grep ONCE. `-e` is mandatory: the combined pattern starts with
# `-----BEGIN…`, which git would otherwise parse as an option. Capture the exit
# code explicitly — git grep returns 0 (matches), 1 (no matches → clean), or
# >1 (ERROR). An error MUST fail loudly, never be silently treated as "clean"
# (that would turn this security gate into a false-green).
GREP_ERR="$(mktemp)"
trap 'rm -f "$GREP_ERR"' EXIT
MATCHES="$(git grep -nIE -e "$COMBINED" -- . 2>"$GREP_ERR")"
GREP_RC=$?
if [ "$GREP_RC" -gt 1 ]; then
  echo "✘ Secret scan ERROR: git grep failed (rc=$GREP_RC) — NOT treating as clean." >&2
  cat "$GREP_ERR" >&2
  exit 2
fi

while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  file="${hit%%:*}"
  rest="${hit#*:}"          # line:content
  line_content="${rest#*:}"
  # Skip this scanner itself (it documents the patterns it hunts).
  case "$file" in
    scripts/prevent-secrets.sh) continue ;;
  esac
  # Inline allowlist pragma.
  case "$line_content" in
    *"pragma: allowlist secret"*) continue ;;
  esac
  # Placeholder DB creds are not secrets (CI service-container defaults etc.).
  if printf '%s' "$line_content" | grep -qE "$PG_PLACEHOLDERS"; then continue; fi
  # Interpolated values (env/shell vars) are not literal secrets.
  case "$line_content" in
    *'${'*|*'process.env'*|*'import.meta.env'*) continue ;;
  esac
  if [ "$FOUND" -eq 0 ]; then
    echo "✘ Secret scan: potential secret(s) detected — commit blocked." >&2
    echo "  (Add 'pragma: allowlist secret' on the line if it is a documented sample.)" >&2
    echo >&2
  fi
  FOUND=1
  echo "  $file:$rest" >&2
done <<< "$MATCHES"

if [ "$FOUND" -ne 0 ]; then
  echo >&2
  echo "✘ Secret scan FAILED. Remove the secret(s) above (and rotate them if real)." >&2
  exit 1
fi

echo "✓ Secret scan: no high-confidence secrets in tracked files."
exit 0
