#!/usr/bin/env bash
# Install TheoClaw from this checkout (B-374, OC-30): install and build the app and its workspace
# dependencies, then write the `theoclaw` launcher into ${THEOCLAW_BIN_DIR:-~/.local/bin}.
# Running it again rebuilds and rewrites the same launcher.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$APP_DIR/../.." && pwd)"
BIN_DIR="${THEOCLAW_BIN_DIR:-$HOME/.local/bin}"

fail() {
  echo "theoclaw install: $*" >&2
  exit 1
}

# Every check runs before anything is written.
command -v git >/dev/null 2>&1 || fail "git is required"
command -v node >/dev/null 2>&1 || fail "node 22 or later is required"
major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$major" =~ ^[0-9]+$ ]] && ((major >= 22)) || fail "node 22 or later is required (found $(node --version))"

# A bare `corepack enable` writes into Node's global bin, which a non-root user cannot write; the
# shim goes into a directory this user owns, on PATH for the rest of the script, since the build
# script spawns a bare `pnpm`. The launcher runs only `node`, so the shim need not stay on PATH.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if ! command -v pnpm >/dev/null 2>&1; then
  command -v corepack >/dev/null 2>&1 || fail "pnpm, or corepack to provide it, is required"
  SHIM_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/theoclaw/bin"
  mkdir -p "$SHIM_DIR"
  corepack enable --install-directory "$SHIM_DIR" pnpm
  export PATH="$SHIM_DIR:$PATH"
fi

cd "$ROOT"
pnpm install --frozen-lockfile --filter 'theoclaw...'
node scripts/live-model-build.mjs theoclaw
chmod +x "$APP_DIR/dist/cli.js"

mkdir -p "$BIN_DIR"
temporary="$BIN_DIR/.theoclaw.$$.tmp"
printf '#!/bin/sh\nexec node "%s" "$@"\n' "$APP_DIR/dist/cli.js" >"$temporary"
chmod 0755 "$temporary"
mv -f "$temporary" "$BIN_DIR/theoclaw"

# Last, so a failed install never leaves it current: `theoclaw update` re-runs an install whose
# marker names an older commit than HEAD.
git -C "$ROOT" rev-parse HEAD >"$APP_DIR/dist/.installed-commit"

echo "theoclaw install: installed $BIN_DIR/theoclaw"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "theoclaw install: $BIN_DIR is not on PATH; add it to run theoclaw by name" ;;
esac
