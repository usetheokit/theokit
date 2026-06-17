#!/usr/bin/env bash
# Coordinated publish of the TheoKit npm packages (theokit + create-theokit).
#
# Safety model (EC-12):
#   1. Require NPM_TOKEN (exit 2 if unset — fail before touching the registry).
#   2. Dry-run EVERY package first; abort the whole run if any dry-run fails.
#   3. Only then do the real publish, package by package.
#   4. If a real publish fails mid-run, roll back the dist-tag on the packages
#      already published this run (`npm dist-tag rm`) so the cohort is not left
#      half-released.
#
# Env:
#   NPM_TOKEN     required — npm automation token.
#   PUBLISH_TAG   dist-tag to publish under (default: next).
set -euo pipefail

if [ -z "${NPM_TOKEN:-}" ]; then
  echo "[publish-coordinated] NPM_TOKEN unset — export NPM_TOKEN before publishing." >&2
  exit 2
fi

TAG="${PUBLISH_TAG:-next}"
PACKAGES=(packages/theo packages/create-theo)

# Temp .npmrc carrying the token; removed on any exit via trap.
NPMRC="$(pwd)/.npmrc.publish-coordinated"
cleanup_npmrc() {
  rm -f "$NPMRC"
}
trap cleanup_npmrc EXIT
printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$NPMRC"

# 1. Dry-run every package BEFORE the real publish.
for pkg in "${PACKAGES[@]}"; do
  echo "[publish-coordinated] dry-run: $pkg"
  ( cd "$pkg" && pnpm publish --dry-run --no-git-checks --tag "$TAG" )
done

# 2. Real publish, tracking what we ship so we can roll back on failure.
PUBLISHED=()

rollback() {
  echo "[publish-coordinated] rollback — removing the '$TAG' dist-tag from this run's packages" >&2
  for spec in "${PUBLISHED[@]}"; do
    name="${spec%@*}"
    npm dist-tag rm "$name" "$TAG" || true
  done
}

echo "[publish-coordinated] Real publish (tag: $TAG)"
for pkg in "${PACKAGES[@]}"; do
  name="$(node -p "require('./$pkg/package.json').name")"
  version="$(node -p "require('./$pkg/package.json').version")"
  echo "[publish-coordinated] publishing $name@$version"
  if ( cd "$pkg" && pnpm publish --no-git-checks --tag "$TAG" ); then
    PUBLISHED+=("$name@$version")
  else
    echo "[publish-coordinated] FAIL publishing $name@$version — rolling back" >&2
    rollback
    exit 1
  fi
done

echo "[publish-coordinated] OK — published: ${PUBLISHED[*]}"
