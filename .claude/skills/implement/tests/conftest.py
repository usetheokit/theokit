"""Shared pytest fixtures for implement tests."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).parent.parent
SCRIPTS_DIR = SKILL_ROOT / "scripts"

sys.path.insert(0, str(SCRIPTS_DIR))


def _find_project_root(start: Path) -> Path:
    current = start.resolve()
    while current != current.parent:
        if (current / ".claude").is_dir() or (current / ".git").exists():
            return current
        current = current.parent
    return start.parent.parent.parent


PROJECT_ROOT = _find_project_root(SKILL_ROOT)


@pytest.fixture(scope="session")
def project_root() -> Path:
    return PROJECT_ROOT


@pytest.fixture
def fake_project(tmp_path: Path) -> Path:
    """Create a fake mini-project with src/, tests/integration/, and .git/ marker."""
    root = tmp_path / "fake-project"
    root.mkdir()
    (root / ".git").mkdir()
    (root / "src").mkdir()
    (root / "tests").mkdir()
    (root / "tests" / "integration").mkdir()
    return root
