"""Shared pytest fixtures for discover-plan-confidence tests."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).parent.parent
SCRIPTS_DIR = SKILL_ROOT / "scripts"
FIXTURES_DIR = SKILL_ROOT / "fixtures"
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
def skill_root() -> Path:
    return SKILL_ROOT


@pytest.fixture(scope="session")
def fixtures_dir() -> Path:
    return FIXTURES_DIR


@pytest.fixture(scope="session")
def templates_dir() -> Path:
    return TEMPLATES_DIR


@pytest.fixture(scope="session")
def project_root() -> Path:
    return PROJECT_ROOT


@pytest.fixture(scope="session")
def rubric_path() -> Path:
    return TEMPLATES_DIR / "rubric-discover-plan.md"


@pytest.fixture
def good_discover_plan(fixtures_dir: Path) -> Path:
    return fixtures_dir / "good-discover-plan.md"


@pytest.fixture
def missing_corner_discover_plan(fixtures_dir: Path) -> Path:
    return fixtures_dir / "missing-corner-discover-plan.md"


@pytest.fixture
def synthetic_discover_plan(tmp_path: Path) -> Path:
    """Minimal valid discovery plan with all 10 mandatory sections + 4 corners populated.

    Used by negative-path tests that need a baseline they can break in one specific way.
    """
    body = (
        "# Discovery Plan: Synthetic\n\n"
        "**Slug:** `synthetic`\n"
        "**Owner:** test\n"
        "**Created:** 2026-05-22\n"
        "**Time budget:** 4h\n\n"
        "## Context\n\nTest context for the synthetic discovery plan used in unit tests.\n\n"
        "## Objective\n\nVerify the checker logic with controlled inputs.\n\n"
        "## In-Scope / Out-of-Scope\n\n"
        "| Project | In-scope subdirectories | Reason |\n"
        "|---|---|---|\n"
        "| `.claude/knowledge-base/references/project-a/` | project-a-ts/ | Project A-shape architecture |\n\n"
        "## ADRs\n\n"
        "### D1 — Time budget + stop conditions\n\n**Decision:** 4h total.\n\n"
        "### D2 — Investigation depth\n\n**Decision:** Read end-to-end.\n\n"
        "## Research Questions\n\n"
        "| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |\n"
        "|---|---|---|---|---|---|---|\n"
        "| Q1 | How does Project A test extraction? | tests | `.claude/knowledge-base/references/project-a/` | ast-grep for describe blocks | Read each test fixture | Table: test → fixture |\n"
        "| Q2 | What pgvector version does Project B use? | deps | `.claude/knowledge-base/references/project-b/` | Grep pyproject.toml | Read version range | Version range |\n"
        "| Q3 | Project A's local-dev story | tools | `.claude/knowledge-base/references/project-a/` | SKIP | Read docker-compose | Step-by-step |\n"
        "| Q4 | Project C procedural memory pattern | techniques | `.claude/knowledge-base/references/project-c/` | ast-grep classes | Read each class | Architecture description |\n"
        "| Q5 | Compare add() across projects | techniques | `.claude/knowledge-base/references/project-a/`, `.claude/knowledge-base/references/project-b/` | ast-grep both languages | Read both methods | Side-by-side table |\n\n"
        "## Coverage Matrix\n\n"
        "| Corner | Questions mapped | Status |\n"
        "|---|---|---|\n"
        "| Integration tests | Q1 | Covered |\n"
        "| Dependencies | Q2 | Covered |\n"
        "| Tools | Q3 | Covered |\n"
        "| Techniques | Q4, Q5 | Covered |\n\n"
        "**Coverage: 4/4 corners covered (100%)**\n\n"
        "## Halt-loop Checkpoints\n\n"
        "| Checkpoint | Assertion | Action if fails |\n"
        "|---|---|---|\n"
        "| Before Qx | path exists | mark BLOCKED |\n\n"
        "## Acceptance Criteria\n\n"
        "- [ ] All questions answered\n"
        "- [ ] All citations real\n\n"
        "## Global Definition of Done\n\n"
        "- [ ] Phases completed\n"
        "- [ ] No fabricated citations\n"
    )
    plan = tmp_path / "synthetic-plan.md"
    plan.write_text(body, encoding="utf-8")
    return plan
