"""Shared pytest fixtures for discover-improve tests."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).parent.parent
SCRIPTS_DIR = SKILL_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))


@pytest.fixture
def smelly_blueprint(tmp_path: Path) -> Path:
    """Blueprint with weak imperatives + loopholes to be cleaned by apply_fixes."""
    bp = tmp_path / "smelly.md"
    bp.write_text(
        "# Blueprint: Smelly\n\n"
        "We should add this if possible. The system could be improved when applicable. "
        "It may also be worth considering an alternative implementation.\n\n"
        "```typescript\n"
        "// This may stay as is - should not be modified\n"
        "if (something) { return; }\n"
        "```\n",
        encoding="utf-8",
    )
    return bp


@pytest.fixture
def fab_citation_blueprint(tmp_path: Path) -> Path:
    """Blueprint with a fabricated .claude/knowledge-base/references/ citation."""
    bp = tmp_path / "fab.md"
    bp.write_text(
        "# Blueprint: Fab\n\n"
        "Cite a fake path: .claude/knowledge-base/references/project-a/never-exists-zzz.py:99\n",
        encoding="utf-8",
    )
    return bp
