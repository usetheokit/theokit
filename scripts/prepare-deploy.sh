#!/usr/bin/env bash
#
# prepare-deploy.sh — convert the theokit working tree from "dev mode"
# (cross-repo workspace link to ../theokit-sdk) to "deploy mode"
# (npm-published @usetheo/sdk + gateways), suitable for theokit-packs +
# TheoCloud's Docker build pipeline.
#
# Idempotent: running twice has no further effect after the first run.
#
# What it does
# ------------
#   1. Copies pnpm-workspace.deploy.yaml over pnpm-workspace.yaml.
#      The sibling entries ../theokit-sdk/packages/{sdk,gateway,gateway-telegram}
#      disappear; nothing else changes.
#
#   2. For every package.json under examples/ and fixtures/template-*/,
#      rewrites workspace:* dependencies on @usetheo/sdk,
#      @usetheo/gateway, and @usetheo/gateway-telegram to the published
#      version range. The pin source-of-truth is pinned-deploy-versions.json
#      next to this script.
#
#   3. Adds pnpm.overrides at the root package.json for the same three
#      packages so resolution is consistent even if a transitive dep
#      asks for a different version.
#
# What it does NOT do
# -------------------
#   - Does not run pnpm install. The caller (TheoCloud Argo, this script's
#     CI, the developer) decides when to install.
#   - Does not touch package.json files of packages/ or apps not derived
#     from the workspace:* SDK family.
#   - Does not produce a Dockerfile. theokit-packs-generate is invoked
#     separately, AFTER this script.
#
# Usage
# -----
#   scripts/prepare-deploy.sh              # apply to current working tree
#   scripts/prepare-deploy.sh --check      # exit non-zero if not already
#                                          # in deploy mode (CI safety)
#
# See docs/contracts/theokit-packs-cli-contract.md and
# theokit/CONTRIBUTING.md § Deploy mode.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PINS="$ROOT/scripts/pinned-deploy-versions.json"
CHECK_ONLY=0

if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=1
fi

if [[ ! -f "$PINS" ]]; then
  echo "fatal: $PINS missing — cannot resolve deploy pins" >&2
  exit 2
fi

# Load pins
SDK_VERSION=$(jq -r '."@usetheo/sdk"' "$PINS")
GW_VERSION=$(jq -r '."@usetheo/gateway"' "$PINS")
GW_TG_VERSION=$(jq -r '."@usetheo/gateway-telegram"' "$PINS")

if [[ -z "$SDK_VERSION" || "$SDK_VERSION" == "null" ]]; then
  echo "fatal: $PINS missing @usetheo/sdk entry" >&2
  exit 2
fi

# Step 1 — pnpm-workspace.yaml
src="$ROOT/pnpm-workspace.deploy.yaml"
dst="$ROOT/pnpm-workspace.yaml"
if [[ ! -f "$src" ]]; then
  echo "fatal: $src missing" >&2
  exit 2
fi

ws_diff_lines=0
if ! diff -q "$src" "$dst" >/dev/null 2>&1; then
  ws_diff_lines=1
fi

if [[ $CHECK_ONLY -eq 1 ]]; then
  if [[ $ws_diff_lines -ne 0 ]]; then
    echo "not in deploy mode: pnpm-workspace.yaml differs from pnpm-workspace.deploy.yaml" >&2
    exit 1
  fi
else
  cp "$src" "$dst"
fi

# Step 2 — rewrite workspace:* in examples/ and fixtures/template-*/
mapfile -t targets < <(find "$ROOT/examples" "$ROOT/fixtures" -name package.json -not -path "*/node_modules/*" 2>/dev/null)

rewritten=0
for f in "${targets[@]}"; do
  changed=0
  for pkg_version in \
    "@usetheo/sdk:$SDK_VERSION" \
    "@usetheo/gateway:$GW_VERSION" \
    "@usetheo/gateway-telegram:$GW_TG_VERSION"; do
    pkg="${pkg_version%%:*}"
    ver="${pkg_version#*:}"
    # only rewrite if the current value is workspace:* exactly
    if jq -e --arg pkg "$pkg" '.dependencies[$pkg] == "workspace:*"' "$f" >/dev/null 2>&1; then
      if [[ $CHECK_ONLY -eq 1 ]]; then
        echo "not in deploy mode: $f still has $pkg: workspace:*" >&2
        exit 1
      fi
      jq --arg pkg "$pkg" --arg ver "$ver" '.dependencies[$pkg] = $ver' "$f" > "$f.tmp"
      mv "$f.tmp" "$f"
      changed=1
    fi
  done
  if [[ $changed -eq 1 ]]; then
    rewritten=$((rewritten + 1))
  fi
done

# Step 3 — pnpm.overrides at root package.json
root_pkg="$ROOT/package.json"
expected_overrides=$(jq -n \
  --arg sdk "$SDK_VERSION" \
  --arg gw "$GW_VERSION" \
  --arg gwtg "$GW_TG_VERSION" \
  '{"@usetheo/sdk": $sdk, "@usetheo/gateway": $gw, "@usetheo/gateway-telegram": $gwtg}')

current_overrides=$(jq '.pnpm.overrides // {}' "$root_pkg")

# Merge: deploy pins win, but keep any existing entries (like zod)
merged=$(jq -n \
  --argjson current "$current_overrides" \
  --argjson expected "$expected_overrides" \
  '$current + $expected')

if [[ $CHECK_ONLY -eq 1 ]]; then
  # Compare current with merged. If merged has keys current lacks, fail.
  missing=$(jq -n --argjson current "$current_overrides" --argjson expected "$expected_overrides" \
    '[$expected | keys[] | select(. as $k | $current | has($k) | not)]')
  if [[ "$(echo "$missing" | jq 'length')" != "0" ]]; then
    echo "not in deploy mode: pnpm.overrides missing $missing" >&2
    exit 1
  fi
else
  jq --argjson merged "$merged" '.pnpm.overrides = $merged' "$root_pkg" > "$root_pkg.tmp"
  mv "$root_pkg.tmp" "$root_pkg"
fi

if [[ $CHECK_ONLY -eq 1 ]]; then
  echo "OK: deploy mode active"
else
  echo "prepare-deploy: workspace=$([[ $ws_diff_lines -eq 0 ]] && echo unchanged || echo updated), packages rewritten=$rewritten, root overrides synced"
fi
