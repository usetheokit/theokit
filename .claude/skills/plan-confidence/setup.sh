#!/usr/bin/env bash
# setup.sh — Install plan-confidence + plan-improve skills into a target project.
#
# Usage:
#   bash setup.sh [TARGET_PROJECT_DIR] [--with-rules] [--with-gate] [--all]
#
# Default: copies only the skills (minimal install).
# --with-rules: also copies rule templates to .claude/rules/
# --with-gate:  also copies the bash CI gate to scripts/
# --all:        equivalent to --with-rules --with-gate
#
# The script auto-detects the SOURCE location (where this script lives) and
# the TARGET (defaults to current working directory).

set -euo pipefail

SOURCE_SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_SKILLS_PARENT="$(cd "${SOURCE_SKILL_DIR}/.." && pwd)"
# Walk up: skills/ -> .claude/ -> actual project root
SOURCE_CLAUDE_DIR="$(cd "${SOURCE_SKILLS_PARENT}/.." && pwd)"
SOURCE_PROJECT_ROOT="$(cd "${SOURCE_CLAUDE_DIR}/.." && pwd)"

TARGET="${1:-$(pwd)}"
WITH_RULES=0
WITH_GATE=0

for arg in "$@"; do
    case "$arg" in
        --with-rules) WITH_RULES=1 ;;
        --with-gate)  WITH_GATE=1 ;;
        --all)        WITH_RULES=1; WITH_GATE=1 ;;
        -h|--help)
            grep '^#' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
    esac
done

if [[ ! -d "$TARGET" ]]; then
    echo "❌ Target directory does not exist: $TARGET" >&2
    exit 2
fi

TARGET="$(cd "$TARGET" && pwd)"

echo "📦 Plan-Confidence Portable Installer"
echo "Source: $SOURCE_PROJECT_ROOT"
echo "Target: $TARGET"
echo ""

if [[ "$SOURCE_PROJECT_ROOT" == "$TARGET" ]]; then
    echo "⚠️  Source and target are the same project. Nothing to copy (would overwrite source)."
    exit 0
fi
# Also guard against target being INSIDE the source's .claude/skills/
if [[ "$TARGET" == "$SOURCE_CLAUDE_DIR"* ]]; then
    echo "❌ Target is inside the source .claude/ — would corrupt source files." >&2
    echo "   Source .claude/: $SOURCE_CLAUDE_DIR" >&2
    echo "   Target:          $TARGET" >&2
    exit 2
fi

# 1. Copy skill directories
echo "1️⃣  Copying skills to $TARGET/.claude/skills/ ..."
mkdir -p "$TARGET/.claude/skills"
cp -r "$SOURCE_SKILLS_PARENT/plan-confidence" "$TARGET/.claude/skills/"
echo "    ✓ plan-confidence/"
if [[ -d "$SOURCE_SKILLS_PARENT/plan-improve" ]]; then
    cp -r "$SOURCE_SKILLS_PARENT/plan-improve" "$TARGET/.claude/skills/"
    echo "    ✓ plan-improve/"
fi

# Clean up __pycache__ in copies
find "$TARGET/.claude/skills/plan-confidence" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$TARGET/.claude/skills/plan-improve" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

# 2. Optionally copy rule templates
if [[ "$WITH_RULES" == "1" ]]; then
    echo ""
    echo "2️⃣  Copying rule templates to $TARGET/.claude/rules/ ..."
    mkdir -p "$TARGET/.claude/rules"
    TEMPLATES="$TARGET/.claude/skills/plan-confidence/templates"

    for tmpl in \
        "plan-confidence-thresholds" \
        "plan-confidence-golden-rule" \
        "plan-confidence-allowlist"
    do
        # Determine extension
        if [[ -f "$TEMPLATES/${tmpl}.example.txt" ]]; then
            ext="txt"
        elif [[ -f "$TEMPLATES/${tmpl}.example.md" ]]; then
            ext="md"
        else
            continue
        fi
        dest="$TARGET/.claude/rules/${tmpl}.${ext}"
        if [[ -f "$dest" ]]; then
            echo "    ⚠️  Already exists, skipping: $dest"
        else
            cp "$TEMPLATES/${tmpl}.example.${ext}" "$dest"
            echo "    ✓ ${tmpl}.${ext}"
        fi
    done
fi

# 3. Optionally install the bash CI gate
if [[ "$WITH_GATE" == "1" ]]; then
    echo ""
    echo "3️⃣  Installing CI gate to $TARGET/scripts/ ..."
    SRC_GATE="$SOURCE_PROJECT_ROOT/scripts/check-plan-confidence.sh"
    if [[ -f "$SRC_GATE" ]]; then
        mkdir -p "$TARGET/scripts"
        cp "$SRC_GATE" "$TARGET/scripts/"
        chmod +x "$TARGET/scripts/check-plan-confidence.sh"
        echo "    ✓ scripts/check-plan-confidence.sh"
        echo ""
        echo "    To add the Makefile target, append:"
        echo ""
        echo "    .PHONY: check-plan-confidence"
        echo "    check-plan-confidence:"
        echo "    	@bash scripts/check-plan-confidence.sh"
    else
        echo "    ⚠️  Source gate not found: $SRC_GATE"
    fi
fi

# 4. Verify install
echo ""
echo "4️⃣  Verifying install ..."
SKILL_MD="$TARGET/.claude/skills/plan-confidence/SKILL.md"
if [[ -f "$SKILL_MD" ]]; then
    echo "    ✓ SKILL.md present"
else
    echo "    ❌ SKILL.md missing!"
    exit 1
fi

# Gap-1 fix: hard check for Python 3.10+ and PyYAML.
# Without these, the skill cannot function. Fail loudly with clear remediation.
if ! command -v python3 >/dev/null 2>&1; then
    echo "    ❌ python3 not found in PATH"
    echo "       Install Python 3.10+ from https://www.python.org/"
    exit 2
fi

PY_VERSION_OK=$(python3 -c 'import sys; print(1 if sys.version_info >= (3, 10) else 0)' 2>/dev/null || echo 0)
if [[ "$PY_VERSION_OK" != "1" ]]; then
    echo "    ❌ Python 3.10+ required (found: $(python3 --version 2>&1))"
    exit 2
fi
echo "    ✓ Python 3.10+ present ($(python3 --version 2>&1))"

if ! python3 -c "import yaml" 2>/dev/null; then
    echo "    ❌ PyYAML NOT installed — the skill REQUIRES it at runtime"
    echo ""
    echo "       Install it with one of:"
    echo "         pip install PyYAML"
    echo "         python3 -m pip install PyYAML"
    echo "         pip3 install PyYAML"
    echo ""
    echo "       Setup completed file copy, but the skill will fail until PyYAML is installed."
    exit 3
fi
echo "    ✓ PyYAML installed"

RUNNER="$TARGET/.claude/skills/plan-confidence/scripts/run_structural.py"
if [[ -f "$RUNNER" ]]; then
    if python3 "$RUNNER" --help >/dev/null 2>&1; then
        echo "    ✓ run_structural.py --help works"
    else
        echo "    ❌ run_structural.py --help FAILED"
        echo "       Run manually to see the error: python3 $RUNNER --help"
        exit 4
    fi
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "  1. (Optional) Customize $TARGET/.claude/rules/plan-confidence-thresholds.txt"
echo "  2. (Optional) Add your own rules to $TARGET/.claude/rules/"
echo "  3. Try it: python3 $TARGET/.claude/skills/plan-confidence/scripts/run_structural.py --help"
echo "  4. See $TARGET/.claude/skills/plan-confidence/PORTABLE.md for details"
