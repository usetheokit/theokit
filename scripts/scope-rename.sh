#!/usr/bin/env bash
# scope-rename.sh — cross-repo codemod for @usetheo/* → @theokit/* rename.
#
# Per .claude/knowledge-base/plans/scope-rename-usetheo-to-theokit-plan.md T1.1.
# Idempotent: running twice produces the same result as running once.
#
# - Renames `@usetheo/<x>` → `@theokit/<x>` everywhere except `node_modules`,
#   `dist`, `.next`, `.theo`, `out`, `coverage`, `test-results`, `.git`,
#   `architecture-output`, `playwright-report`.
# - For package.json: uses `jq` to safely rewrite `name` + 4 dep blocks.
# - For source files (.ts/.tsx/.js/.mjs/.cjs/.json/.md/.mdx/.yaml/.yml/.txt/.html):
#   uses `sed` in-place.
#
# EC-1 absorbed: detects BSD vs GNU sed for cross-platform compatibility.
# EC-4 absorbed: handles .changeset/*.md with YAML frontmatter via the .md
#   extension (sed string replace is YAML-safe for our flat pattern).
# EC-9 documented: jq canonicalizes JSON formatting (2-space indent, no
#   trailing newline). PR diff will include whitespace noise — acceptable.

set -euo pipefail

ROOT="${1:-$PWD}"

if [ ! -d "$ROOT" ]; then
  echo "ERROR: not a directory: $ROOT" >&2
  exit 1
fi

# EC-1: cross-platform sed in-place
if [[ "$OSTYPE" == "darwin"* ]]; then
  SED_INPLACE=(sed -i '')
else
  SED_INPLACE=(sed -i)
fi

# Excluded directory patterns (find -prune)
EXCLUDE_DIRS=(
  -path '*/node_modules' -o
  -path '*/.git' -o
  -path '*/dist' -o
  -path '*/.next' -o
  -path '*/.theo' -o
  -path '*/out' -o
  -path '*/coverage' -o
  -path '*/test-results' -o
  -path '*/playwright-report' -o
  -path '*/architecture-output' -o
  -path '*/.changeset/.cache' -o
  -path '*/scripts/fixtures'
)

# Excluded file names — the codemod must NEVER rewrite:
#   - itself (would corrupt sed pattern, see T2.1 dogfood)
#   - lockfiles (pnpm install regenerates them post-rename)
EXCLUDE_FILES=(
  -name 'scope-rename.sh' -o
  -name 'scope-rename.test.sh' -o
  -name 'package-lock.json' -o
  -name 'yarn.lock' -o
  -name 'pnpm-lock.yaml' -o
  -name 'bun.lockb'
)

# Source-file extensions to rewrite.
# Includes:
#   - TS family: .ts, .tsx, .d.ts, .d.mts, .d.cts
#   - JS family: .js, .mjs, .cjs, .jsx
#   - Docs/config: .md, .mdx, .yaml, .yml, .txt, .html, .css, .json5
#   - Shell scripts: .sh
#   - Scaffolder templates: .tmpl
# Discovered during dogfood of T2.1 (theokit/): .tmpl + .sh + .d.mts files
# missed by original allowlist. .githooks/pre-commit (no extension, shebang
# script) is handled by an explicit second pass below.
SOURCE_EXTS=(
  -name '*.ts' -o
  -name '*.tsx' -o
  -name '*.js' -o
  -name '*.mjs' -o
  -name '*.cjs' -o
  -name '*.jsx' -o
  -name '*.d.mts' -o
  -name '*.d.cts' -o
  -name '*.md' -o
  -name '*.mdx' -o
  -name '*.yaml' -o
  -name '*.yml' -o
  -name '*.txt' -o
  -name '*.html' -o
  -name '*.css' -o
  -name '*.json' -o
  -name '*.json5' -o
  -name '*.sh' -o
  -name '*.py' -o
  -name '*.tmpl' -o
  -name '*.tmpl.*' -o
  -name '*.template'
)

# Explicit extensionless files to also include (shebang scripts in .githooks/, bin/, etc.)
# Path patterns must match the FILE inside the dir, not the dir itself, hence the `/*` suffix.
EXTENSIONLESS_DIRS=(
  -path '*/.githooks/*' -o
  -path '*/bin/*' -o
  -path '*/githooks/*'
)

PKG_JSON_COUNT=0
SOURCE_COUNT=0

# Phase A: package.json files via jq
while IFS= read -r -d '' pkg; do
  # Skip if not a regular file
  [ -f "$pkg" ] || continue

  # Skip if already canonical (no @usetheo/ at all) — fast path
  if ! grep -q '@usetheo/' "$pkg" 2>/dev/null; then
    continue
  fi

  # jq filter: rewrite name + 5 dep blocks (peerDependenciesMeta discovered
  # during T2.1 dogfood — `packages/theo/package.json` declares optional peers
  # via that block; ignoring it leaves stale @usetheo/ui reference behind).
  #
  # IMPORTANT: jq's `(.a, .b) |= X` creates keys .a and .b even if they were
  # absent — leaving `"peerDependencies": null` etc. in the output. pnpm
  # install + eslint-plugin-sonarjs both crash on Object.keys(null) — error
  # "Cannot convert undefined or null to object" (discovered T2.2 dogfood).
  # We use per-key explicit guards: `if has(k) and .k != null then rewrite
  # .k else . end` — preserves the original key absence.
  tmp="$(mktemp)"
  jq '
    def rewrite_keys:
      with_entries(
        if .key | startswith("@usetheo/") then
          .key |= sub("^@usetheo/"; "@theokit/")
        else . end
      );
    def rewrite_dep_block($k):
      if has($k) and (.[$k] != null) then
        .[$k] |= rewrite_keys
      else . end;

    def cleanup_null_dep($k):
      if has($k) and (.[$k] == null) then
        del(.[$k])
      else . end;

    (if (.name? // "" | startswith("@usetheo/")) then
       .name |= sub("^@usetheo/"; "@theokit/")
     else . end)
    | rewrite_dep_block("dependencies")
    | rewrite_dep_block("devDependencies")
    | rewrite_dep_block("peerDependencies")
    | rewrite_dep_block("optionalDependencies")
    | rewrite_dep_block("peerDependenciesMeta")
    # Cleanup pre-existing null entries in any of the 5 dep blocks.
    # Some packages historically were serialized with explicit "peerDependencies": null
    # (a pre-existing crash hazard for pnpm/eslint Object.keys). Codemod sweeps them.
    | cleanup_null_dep("dependencies")
    | cleanup_null_dep("devDependencies")
    | cleanup_null_dep("peerDependencies")
    | cleanup_null_dep("optionalDependencies")
    | cleanup_null_dep("peerDependenciesMeta")
  ' "$pkg" > "$tmp"

  # Validate jq output is non-empty + valid JSON
  if [ ! -s "$tmp" ] || ! jq -e 'type == "object"' "$tmp" > /dev/null 2>&1; then
    echo "ERROR: jq produced invalid output for $pkg" >&2
    rm -f "$tmp"
    exit 1
  fi

  mv "$tmp" "$pkg"
  PKG_JSON_COUNT=$((PKG_JSON_COUNT + 1))
done < <(
  find "$ROOT" \
    \( "${EXCLUDE_DIRS[@]}" \) -prune \
    -o \( "${EXCLUDE_FILES[@]}" \) -prune \
    -o -type f -name 'package.json' -print0
)

# Phase A2: re-pass over package.json files with sed to rewrite STRING-VALUE
# references in fields jq doesn't cover (scripts, description, repository.url,
# homepage, keywords[]). Discovered during T2.2 dogfood (theokit-sdk):
# `"scripts": { "test:roadmap": "pnpm --filter=@usetheo/sdk exec ..." }` +
# `"description": "WhatsApp platform adapter for @usetheo/gateway ..."`.
# Idempotent — second pass finds no @usetheo/ to substitute.
PKG_JSON_STRPASS=0
while IFS= read -r -d '' pkg; do
  [ -f "$pkg" ] || continue
  if ! grep -q '@usetheo/' "$pkg" 2>/dev/null; then
    continue
  fi
  "${SED_INPLACE[@]}" 's|@usetheo/|@theokit/|g' "$pkg"
  PKG_JSON_STRPASS=$((PKG_JSON_STRPASS + 1))
done < <(
  find "$ROOT" \
    \( "${EXCLUDE_DIRS[@]}" \) -prune \
    -o \( "${EXCLUDE_FILES[@]}" \) -prune \
    -o -type f -name 'package.json' -print0
)

# Phase B: source files via sed (extension allowlist)
while IFS= read -r -d '' src; do
  [ -f "$src" ] || continue

  # Fast path: skip if no @usetheo anywhere (substring match — catches both
  # `@usetheo/` and the regex-escaped `@usetheo\/`).
  if ! grep -q '@usetheo' "$src" 2>/dev/null; then
    continue
  fi

  # Primary pattern: literal @usetheo/
  "${SED_INPLACE[@]}" 's|@usetheo/|@theokit/|g' "$src"
  # Secondary pattern: regex-escaped @usetheo\/ (e.g. in TypeScript regex literals
  # like `/@usetheo\/plugin-openapi/`). Discovered T2.4 dogfood — test files
  # asserting `expect(x).toMatch(/import ... @usetheo\/plugin-openapi/)`.
  "${SED_INPLACE[@]}" 's|@usetheo\\/|@theokit\\/|g' "$src"
  SOURCE_COUNT=$((SOURCE_COUNT + 1))
done < <(
  find "$ROOT" \
    \( "${EXCLUDE_DIRS[@]}" \) -prune \
    -o \( "${EXCLUDE_FILES[@]}" \) -prune \
    -o -type f \( "${SOURCE_EXTS[@]}" \) -print0
)

# Phase C: extensionless shebang scripts inside .githooks/, bin/, etc.
# Codemod must pick up git hooks like .githooks/pre-commit that reference
# @usetheo/* in comments or in $(grep)/$(npm view) calls.
EXTENSIONLESS_COUNT=0
while IFS= read -r -d '' src; do
  [ -f "$src" ] || continue
  # Skip if has an extension (covered by Phase B already)
  case "$(basename "$src")" in
    *.*) continue ;;
  esac
  # Must look like a shebang script
  head -c 2 "$src" 2>/dev/null | grep -q '^#!' || continue
  # Fast path: skip if no @usetheo/
  if ! grep -q '@usetheo/' "$src" 2>/dev/null; then
    continue
  fi
  "${SED_INPLACE[@]}" 's|@usetheo/|@theokit/|g' "$src"
  EXTENSIONLESS_COUNT=$((EXTENSIONLESS_COUNT + 1))
done < <(
  find "$ROOT" \
    \( "${EXCLUDE_DIRS[@]}" \) -prune \
    -o \( "${EXCLUDE_FILES[@]}" \) -prune \
    -o -type f \( "${EXTENSIONLESS_DIRS[@]}" \) -print0
)

echo "scope-rename: rewrote $PKG_JSON_COUNT package.json (jq) + $PKG_JSON_STRPASS package.json (string-pass) + $SOURCE_COUNT source files + $EXTENSIONLESS_COUNT shebang scripts under $ROOT"
