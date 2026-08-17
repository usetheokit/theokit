#!/usr/bin/env bash
# setup.sh — Verify ast-grep is installed and runnable.
#
# Exit codes:
#   0 — ast-grep is present and working
#   1 — ast-grep not found; install command printed
#   2 — ast-grep found but failed to execute
#
# Usage: bash .claude/skills/ast-grep/setup.sh

set -uo pipefail

echo "ast-grep skill — install verifier"
echo ""

# Detect the binary. Prefer the long name `ast-grep` to avoid Linux collision with /usr/bin/sg.
if command -v ast-grep >/dev/null 2>&1; then
    BIN="ast-grep"
elif command -v sg >/dev/null 2>&1; then
    # /usr/bin/sg is switch-group (shadow-utils). Check it actually behaves like ast-grep.
    if sg --version 2>/dev/null | grep -qi "ast-grep"; then
        BIN="sg"
    else
        echo "WARNING: 'sg' is on PATH but appears to be switch-group, not ast-grep."
        BIN=""
    fi
else
    BIN=""
fi

if [[ -z "$BIN" ]]; then
    echo "ERROR: ast-grep is NOT installed."
    echo ""
    echo "Install with ONE of:"
    echo "  npm install -g @ast-grep/cli         # recommended for Node projects"
    echo "  cargo install ast-grep --locked      # Rust toolchain"
    echo "  brew install ast-grep                # macOS / Homebrew"
    echo ""
    echo "If your project has package.json, prefer the devDependency path:"
    echo "  npm install --save-dev @ast-grep/cli"
    echo "  then call via: npx ast-grep ..."
    echo ""
    echo "After installing, re-run this script to verify."
    exit 1
fi

VERSION=$("$BIN" --version 2>&1 || true)
if [[ -z "$VERSION" ]]; then
    echo "ERROR: '$BIN' is present but '--version' failed."
    echo "       Manually run '$BIN --help' to diagnose."
    exit 2
fi

echo "OK: $BIN ($VERSION)"

# Self-scan: try one of the rule files to confirm scan+parse works end-to-end.
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULE="$SKILL_DIR/rules/class-extends-ts.yml"

if [[ -f "$RULE" ]]; then
    if "$BIN" scan --rule "$RULE" "$SKILL_DIR" >/dev/null 2>&1; then
        echo "OK: $BIN scan with rule file works"
    else
        echo "WARN: $BIN found but 'scan --rule' returned non-zero. Rules may need refresh."
    fi
else
    echo "WARN: Rule file missing at $RULE — skill files may be incomplete."
fi

echo ""
echo "ast-grep is ready. Try:"
echo "  $BIN run --pattern 'class \$NAME extends \$BASE { \$\$\$ }' --lang typescript path/to/code/"
echo "  $BIN scan --rule .claude/skills/ast-grep/rules/decorated-function-python.yml .claude/knowledge-base/references/project-b/"

exit 0
