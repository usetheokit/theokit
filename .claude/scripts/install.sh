#!/usr/bin/env bash
# Installs the plan 4+1 cycle ecosystem into a target project as a plugin install
# (target/.claude/ layout). Hooks auto-detect the layout, so target/.claude/* is
# picked up identically to the standalone repo.
#
# Usage:
#   bash scripts/install.sh <target-project-dir> [--force]
#
# What it does:
#   1. Validates target is a directory.
#   2. Refuses to overwrite an existing target/.claude/ unless --force.
#   3. Copies skills/, rules/, hooks/, commands/, scripts/, plugin.json,
#      HOW-TO-USE.md into target/.claude/.
#   4. Writes settings.plugin.json as target/.claude/settings.json.
#   5. Creates empty scaffold under target/.claude/knowledge-base/
#      (plans, implementations, reviews, audits, discoveries/{plans,blueprints,snapshots},
#      adrs, grills, dogfood, judge-codex, references, tools) + empty agents/.
#   6. Skips the source repo's history: caches, artifact dirs, audit trails,
#      CHANGELOG.md, .git/, .compaction-snapshots/, .attestations/.
#   7. Prints next steps.
#
# What it does NOT do:
#   - Modify the consumer's CLAUDE.md (write your own pointer to .claude/).
#   - Add anything to .gitignore (consumer decides whether to track .claude/).
#   - Install dependencies (python3, jq, ast-grep, ralph-loop plugin) — see HOW-TO-USE.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- args ---
if [ $# -lt 1 ]; then
  echo "Usage: bash scripts/install.sh <target-project-dir> [--force]" >&2
  exit 2
fi

TARGET="$1"
FORCE=0
if [ "${2:-}" = "--force" ]; then
  FORCE=1
fi

if [ ! -d "$TARGET" ]; then
  echo "ERROR: target is not a directory: $TARGET" >&2
  exit 2
fi

TARGET="$(cd "$TARGET" && pwd)"
ECO="$TARGET/.claude"

if [ "$TARGET" = "$SRC_DIR" ]; then
  echo "ERROR: target is the source repo itself. install.sh is for installing the ecosystem INTO another project." >&2
  exit 2
fi

if [ -d "$ECO" ] && [ "$FORCE" -ne 1 ]; then
  echo "ERROR: $ECO already exists. Use --force to overwrite (existing knowledge-base/ contents will be preserved if also present)." >&2
  exit 2
fi

echo "==> Installing plan ecosystem"
echo "    source: $SRC_DIR"
echo "    target: $ECO"

# --- copy ecosystem code ---
mkdir -p "$ECO"
for item in skills rules hooks commands scripts; do
  echo "==> Copying $item/"
  rm -rf "$ECO/$item"
  cp -r "$SRC_DIR/$item" "$ECO/$item"
done

# Top-level docs and manifest
for f in plugin.json HOW-TO-USE.md README.md .active_plan.example; do
  [ -f "$SRC_DIR/$f" ] && cp "$SRC_DIR/$f" "$ECO/$f"
done

# --- settings.json (plugin install variant) ---
if [ ! -f "$SRC_DIR/settings.plugin.json" ]; then
  echo "ERROR: $SRC_DIR/settings.plugin.json missing — required for plugin install layout." >&2
  exit 1
fi
cp "$SRC_DIR/settings.plugin.json" "$ECO/settings.json"
echo "==> settings.json written (plugin install variant)"

# --- knowledge-base scaffold (empty, idempotent) ---
# Mirrors the SEMANTIC structure of the source's knowledge-base/ — every
# category folder that a cycle writes to. Slug-keyed subdirs that exist in
# the source (e.g. implementations/slice-X/, tools/argo-cd/, discoveries/
# snapshots/slice-X/) are NOT mirrored — those are historical artefacts of
# the plan repo's own dogfood, not part of the template.
echo "==> Scaffolding knowledge-base/ subdirs (semantic structure)"
KB_DIRS=(
  "plans"                       # /to-plan outputs
  "implementations"             # /implement halt-loop logs
  "reviews"                     # /review reports
  "audits"                      # /code-quality + /deps-audit reports
  "adrs"                        # MADR 3.0 ADRs
  "grills"                      # /grill-me Q&A logs
  "dogfood"                     # /dogfood anchor manifest
  "dogfood/evidence"            # /dogfood evidence files
  "judge-codex"                 # orthogonal LLM jury outputs (optional plugin)
  "references"                  # read-only clones of reference projects (consumer populates)
  "tools"                       # read-only docs of tools the project depends on (consumer populates)
  "discoveries"                 # /discover-* root
  "discoveries/plans"           # /discover-plan outputs
  "discoveries/blueprints"      # /discover-execute outputs
  "discoveries/snapshots"       # WebFetch hash-verified snapshots cited by blueprints
  "progress"                    # per-slug progress.md (read by hooks + session-catchup)
)
for d in "${KB_DIRS[@]}"; do
  mkdir -p "$ECO/knowledge-base/$d"
done

# Optional: bring over the project-agnostic backlog template
if [ -f "$SRC_DIR/knowledge-base/backlog.md" ]; then
  if [ ! -f "$ECO/knowledge-base/backlog.md" ]; then
    cp "$SRC_DIR/knowledge-base/backlog.md" "$ECO/knowledge-base/backlog.md"
  fi
fi

# --- agents/ audit trail dir (empty) ---
mkdir -p "$ECO/agents"

# --- Validation ---
echo "==> Validating install"
python3 "$ECO/scripts/check_xrefs.py" --strict > /dev/null 2>&1 \
  && echo "    check_xrefs.py: OK" \
  || { echo "    check_xrefs.py: FAIL (re-run manually)"; }

python3 "$ECO/scripts/test_e2e_smoke.py" > /dev/null 2>&1 \
  && echo "    test_e2e_smoke.py: OK" \
  || { echo "    test_e2e_smoke.py: FAIL (re-run manually)"; }

cat <<EOF

==> Installation complete.

Next steps for the target project:

  1. (optional) Add a CLAUDE.md at the project root pointing to .claude/ and
     listing project-specific stack/conventions. Hooks read it on SessionStart.

  2. Configure project-specific gates (defaults are no-op until set):
       .claude/rules/code-quality-languages.txt    # uncomment languages you ship
       .claude/rules/discover-web-allowlist.txt    # domains for /discover-execute
       .claude/rules/code-quality-thresholds.txt   # per-project overrides
       .claude/rules/deps-audit-allowlist.txt      # CVE exemptions (with sunset)

  3. Verify ralph-loop plugin is installed (required by /implement, /discover-execute,
     /plan-improve):
       jq '.enabledPlugins' ~/.claude/settings.json | grep ralph-loop

  4. Open the project in Claude Code. The settings.json wires hooks; skills/
     and commands/ are auto-discovered.

  5. First run: /to-plan "{one-sentence feature}"  OR  /grill-me {topic}
EOF
