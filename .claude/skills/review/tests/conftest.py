"""Shared pytest fixtures for review tests."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).parent.parent
SCRIPTS_DIR = SKILL_ROOT / "scripts"
TEMPLATES_DIR = SKILL_ROOT / "templates"

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


@pytest.fixture(scope="session")
def templates_dir() -> Path:
    return TEMPLATES_DIR


@pytest.fixture
def sample_plan(tmp_path: Path) -> Path:
    """A minimal but realistic discovery plan with edge cases + pgvector keywords."""
    plan = tmp_path / "sample-plan.md"
    plan.write_text(
        "# Plan: Sample for testing\n\n"
        "## Context\n\nPgvector schema investigation, src/local/ adapter design.\n\n"
        "## Objective\n\nProduce pgvector-shaped blueprint.\n\n"
        "## ADRs\n\n### D1 — Adopt pgvector schema patterns\n\nProject B uses pgvector.\n\n"
        "## Phase 1\n\n### T1.1 — Schema design\n\n"
        "#### Deep Dives\n\n"
        "- Edge case: empty embedding vector\n"
        "- Edge case: maximum dimension overflow\n"
        "- The schema should handle null values gracefully\n\n"
        "#### Acceptance Criteria\n\n"
        "- [ ] Empty embedding handled\n"
        "- [ ] Maximum dimension boundary tested\n",
        encoding="utf-8",
    )
    return plan
