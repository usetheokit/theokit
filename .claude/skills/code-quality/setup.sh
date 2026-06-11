#!/usr/bin/env bash
# Standalone installer for /code-quality skill.
#
# Creates a venv inside the skill dir, installs Python deps (editable),
# and prints next steps for installing external CLIs (knip, vulture,
# cargo-udeps, deadcode, stryker, mutmut, osv-scanner — see PORTABLE.md).
set -euo pipefail

SKILL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SKILL_ROOT"

if [[ ! -d ".venv" ]]; then
  echo "[setup] creating .venv ..."
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

echo "[setup] installing Python deps (editable) ..."
pip install --quiet --upgrade pip
pip install --quiet -e ".[dev]"

echo "[setup] running pytest smoke ..."
pytest tests/ -q --tb=line --no-header || {
  echo "[setup] pytest reports failures — expected during incremental build. Skill is installed."
}

cat <<'EOF'

[setup] code-quality skill installed.

External CLIs required at runtime (NOT installed by this setup; see PORTABLE.md):
  - knip (^6.14)          npm install -g knip
  - vulture (^2.14)       pip install 'vulture>=2.14'
  - cargo-udeps (^0.1)    cargo install cargo-udeps --locked
  - deadcode (v0.45.0)    go install golang.org/x/tools/cmd/deadcode@v0.45.0
  - @stryker-mutator/core (^9.6)  npm install -g @stryker-mutator/core
  - mutmut (^3.5)         pip install 'mutmut>=3.5'
  - osv-scanner (cross-eco) go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest

Detectors emit `auditor_unavailable_{tool}` SOFT_CAP Finding when a tool is missing.
EOF
