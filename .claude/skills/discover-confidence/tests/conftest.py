"""Shared pytest fixtures for discover-confidence tests."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).parent.parent
SCRIPTS_DIR = SKILL_ROOT / "scripts"
FIXTURES_DIR = SKILL_ROOT / "fixtures"
TEMPLATES_DIR = SKILL_ROOT / "templates"

# Make scripts/ importable
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
    return TEMPLATES_DIR / "rubric-blueprint.md"


@pytest.fixture
def good_blueprint(fixtures_dir: Path) -> Path:
    return fixtures_dir / "good-blueprint.md"


@pytest.fixture
def synthetic_blueprint(tmp_path: Path) -> Path:
    """Minimal valid blueprint for negative-path tests. Each corner has >50 chars of content
    to pass the MIN_CONTENT_CHARS threshold in check_research_coverage.
    """
    body = (
        "# Blueprint: Test\n\n"
        "**Slug:** `test`\n\n"
        "## Context\n\nTest context for the synthetic fixture used in unit tests.\n\n"
        "## Objective\n\nVerify the checker logic with controlled inputs.\n\n"
        "## Coverage Corner 1 — Integration Tests\n\n"
        "### Project A\n\nThis subsection has substantive content describing how integration tests are structured in Project A; well above the threshold required by the checker.\n\n"
        "## Coverage Corner 2 — Dependencies\n\n"
        "### Project A\n\nThis subsection has substantive content describing the dependency profile of Project A with versions and rationale; well above threshold.\n\n"
        "## Coverage Corner 3 — Tools\n\n"
        "### Project A\n\nThis subsection has substantive content describing the local-dev tooling story for Project A with concrete commands and steps.\n\n"
        "## Coverage Corner 4 — Techniques\n\n"
        "### Project A\n\nThis subsection has substantive content describing the core technique borrowed from Project A, with architectural details.\n\n"
        "## Cross-cutting Comparison\n\nA table comparing approaches across projects, with substantive content for each column.\n\n"
        "## ADRs\n\n### D1 — A decision\n\nRationale text here describing the decision and why we made it.\n\n"
        "## Recommendations\n\n- Do X for reason Y as explained in section Z\n"
    )
    bp = tmp_path / "test-blueprint.md"
    bp.write_text(body, encoding="utf-8")
    return bp
