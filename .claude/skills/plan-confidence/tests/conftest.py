"""Shared pytest fixtures and path helpers.

PORTABLE: paths are auto-detected via walk-up from the skill location.
Works in any project that contains a `.claude/` or `.git/` directory at the
expected root (i.e., 3 levels above `.claude/skills/plan-confidence/`).
"""
from __future__ import annotations

from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).parent.parent


def _find_project_root(start: Path) -> Path:
    """Walk up to find project root (.claude/ or .git/). Portable across projects."""
    current = start.resolve()
    while current != current.parent:
        if (current / ".claude").is_dir() or (current / ".git").exists():
            return current
        current = current.parent
    return start.parent.parent.parent


PROJECT_ROOT = _find_project_root(SKILL_ROOT)
RULES_DIR = PROJECT_ROOT / ".claude" / "rules"
CONCEPTS_DIR = PROJECT_ROOT / ".claude" / "knowledge-base" / "concepts" / "plan-confidence"


@pytest.fixture(scope="session")
def skill_root() -> Path:
    """Path to the plan-confidence skill directory."""
    return SKILL_ROOT


@pytest.fixture(scope="session")
def project_root() -> Path:
    """Path to the project root (auto-detected via walk-up)."""
    return PROJECT_ROOT


@pytest.fixture(scope="session")
def rules_dir() -> Path:
    """Path to .claude/rules/ in the host project."""
    return RULES_DIR


@pytest.fixture(scope="session")
def concepts_dir() -> Path:
    """Path to .claude/knowledge-base/concepts/plan-confidence/ in the host project."""
    return CONCEPTS_DIR
