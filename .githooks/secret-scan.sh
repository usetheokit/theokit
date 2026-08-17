#!/usr/bin/env bash
# Secret scanning gate — TruffleHog over the content that is about to be committed.
#
# Why this scans the index and not the working tree: `git add -p` stages hunks, not
# files. Scanning the file on disk would clear a commit whose staged hunk carries the
# credential, and would block a commit whose credential only exists unstaged. The only
# content that matters here is what `git commit` will actually write, so each staged
# blob is materialised from the index with `git show :<path>` and scanned from there.
#
# The gate is fail-closed: a missing binary, an unreadable blob or a scanner error
# aborts the commit. A secret gate that disables itself when its tool is absent reports
# green while protecting nothing, which is worse than having no gate at all — the team
# believes it is covered.
#
# `git commit --no-verify` is the escape hatch. It is deliberate, visible in the
# author's shell history, and the CI workflow re-runs this check on the push, so a
# bypass buys time rather than a permanent hole.

set -euo pipefail

if ! command -v trufflehog >/dev/null 2>&1; then
  cat >&2 <<'MSG'

✗ Secret scanning gate cannot run: `trufflehog` is not on PATH.

  This gate is fail-closed on purpose — it will not wave a commit through just
  because the scanner is missing. Install it and retry:

    TAG=$(curl -sS https://api.github.com/repos/trufflesecurity/trufflehog/releases/latest | jq -r .tag_name)
    curl -sSfL "https://github.com/trufflesecurity/trufflehog/releases/download/${TAG}/trufflehog_${TAG#v}_linux_amd64.tar.gz" \
      | tar xz -C /tmp trufflehog
    install -m 0755 /tmp/trufflehog ~/.local/bin/trufflehog

  macOS: `brew install trufflehog`.

MSG
  exit 1
fi

# --diff-filter=ACM: added, copied and modified paths. Deletions and renames-without-
# edit carry no new content, and a deleted file cannot introduce a credential.
mapfile -d '' STAGED < <(git diff --cached --name-only --diff-filter=ACM -z)

if [[ ${#STAGED[@]} -eq 0 ]]; then
  exit 0
fi

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

# The staged blobs are laid out under their real repository paths so TruffleHog's
# output names the file the author has to fix, not an opaque temporary name.
for path in "${STAGED[@]}"; do
  mkdir -p "$STAGE_DIR/$(dirname "$path")"
  git show ":$path" > "$STAGE_DIR/$path"
done

# All three detection classes block. TruffleHog separates them and the distinction is
# not the intuitive one:
#
#   verified   — authenticated against the provider; the credential is live.
#   unknown    — verification could not COMPLETE: network down, provider throttling.
#   unverified — DETECTED but not confirmed live: the provider said invalid, or the
#                detector has no verifier at all.
#
# `unverified` is the class that carries most of the value, and leaving it out was
# measured to be a hole rather than a theory: with `--results=verified,unknown` a
# staged `ghp_…` GitHub token was scanned and the commit was ALLOWED (exit 0). With
# `unverified` added the same content exits 183 and the commit is blocked. A gate that
# only stops credentials it can prove are live misses every revoked, rotated, typo'd or
# not-yet-activated one — and the structure of a secret in the history is the leak, not
# whether it happens to authenticate today.
#
# Confirmed false positives are silenced per line with a `trufflehog:ignore` comment,
# which is reviewable in the diff, rather than by excluding whole paths — an excluded
# fixture file hides real secrets forever.
if ! trufflehog filesystem "$STAGE_DIR" \
     --results=verified,unknown,unverified \
     --fail \
     --no-update \
     --concurrency=4 2>&1 | sed "s|$STAGE_DIR/||g"; then
  cat >&2 <<'MSG'

✗ Secret scanning gate failed — the staged content contains a credential.

  Do NOT just delete the line and commit. If the credential is real it must be
  treated as compromised the moment it left a password manager:

    1. Rotate it at the provider. Now, before anything else.
    2. Remove it from the staged content; read it from the environment instead.
    3. Re-stage and commit.

  If it is a false positive — a fixture, an example connection string, a documented
  placeholder — append `trufflehog:ignore` as a comment on that line. Silence the
  line, never the file: excluding the path would hide a real secret added to that
  fixture later.

MSG
  exit 1
fi

exit 0
