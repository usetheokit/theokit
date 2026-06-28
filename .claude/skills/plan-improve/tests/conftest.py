"""Shared pytest fixtures and path helpers for plan-improve tests."""
from __future__ import annotations

import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).parent.parent
SCRIPTS_DIR = SKILL_ROOT / "scripts"

# Make scripts/ importable (e.g. `from apply_fixes import ...`)
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
