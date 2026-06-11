"""Shared pytest fixtures for code-quality skill tests."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make scripts/ importable as a package for tests
_SKILL_ROOT = Path(__file__).resolve().parent.parent
if str(_SKILL_ROOT) not in sys.path:
    sys.path.insert(0, str(_SKILL_ROOT))


@pytest.fixture
def skill_root() -> Path:
    """Root of the code-quality skill directory."""
    return _SKILL_ROOT


@pytest.fixture
def repo_root() -> Path:
    """Root of the TheoMemory project (4 levels up from this conftest)."""
    return _SKILL_ROOT.parent.parent.parent


@pytest.fixture
def rules_dir(repo_root: Path) -> Path:
    """`.claude/rules/` directory."""
    return repo_root / ".claude" / "rules"


@pytest.fixture
def fixtures_dir(skill_root: Path) -> Path:
    """`fixtures/` directory inside the skill."""
    return skill_root / "fixtures"
