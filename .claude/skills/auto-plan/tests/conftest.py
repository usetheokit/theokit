"""Shared pytest fixtures for auto-plan tests."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).parent.parent
SCRIPTS_DIR = SKILL_ROOT / "scripts"

sys.path.insert(0, str(SCRIPTS_DIR))


@pytest.fixture(scope="session")
def skill_root() -> Path:
    return SKILL_ROOT


@pytest.fixture
def roadmap_happy(tmp_path: Path) -> Path:
    """Roadmap with M0 [x], M1 [x], M2 [ ] eligible, M3 [ ] depends on M2."""
    body = (
        "# Test Roadmap\n\n"
        "## Milestones\n\n"
        "### M0 — [x] Walking skeleton\n\n"
        "**Objective:** Minimal vertical slice.\n\n"
        "**Definition of done:**\n\n- [x] One endpoint works.\n- [x] One test green.\n\n"
        "**Dependencies:** none.\n\n---\n\n"
        "### M1 — [x] Provider abstraction\n\n"
        "**Objective:** Add second provider.\n\n"
        "**Definition of done:**\n\n- [x] Two providers behind one interface.\n\n"
        "**Dependencies:** M0.\n\n---\n\n"
        "### M2 — [ ] Streaming\n\n"
        "**Objective:** SSE streaming for both providers.\n\n"
        "**Definition of done:**\n\n- [ ] Streaming works.\n- [ ] Cancel propagates.\n\n"
        "**Dependencies:** M1.\n\n---\n\n"
        "### M3 — [ ] Per-org quotas\n\n"
        "**Objective:** Quota enforcement.\n\n"
        "**Definition of done:**\n\n- [ ] Quota config persisted.\n\n"
        "**Dependencies:** M2.\n\n---\n\n"
        "## State-of-the-art references\n\n(table)\n"
    )
    path = tmp_path / "ROADMAP.md"
    path.write_text(body, encoding="utf-8")
    return path


@pytest.fixture
def roadmap_complete(tmp_path: Path) -> Path:
    """Roadmap where every milestone is [x]."""
    body = (
        "# Done Roadmap\n\n"
        "### M0 — [x] Skeleton\n\n**Objective:** done.\n\n"
        "**Definition of done:**\n\n- [x] shipped.\n\n**Dependencies:** none.\n\n---\n\n"
        "### M1 — [x] Feature\n\n**Objective:** done.\n\n"
        "**Definition of done:**\n\n- [x] shipped.\n\n**Dependencies:** M0.\n\n---\n\n"
    )
    path = tmp_path / "ROADMAP.md"
    path.write_text(body, encoding="utf-8")
    return path


@pytest.fixture
def roadmap_blocked(tmp_path: Path) -> Path:
    """Roadmap where every [ ] milestone has an unchecked dep — dependency wall."""
    body = (
        "# Blocked Roadmap\n\n"
        "### M0 — [ ] Foundation\n\n**Objective:** start.\n\n"
        "**Definition of done:**\n\n- [ ] later.\n\n**Dependencies:** M1.\n\n---\n\n"
        "### M1 — [ ] Second\n\n**Objective:** later.\n\n"
        "**Definition of done:**\n\n- [ ] later.\n\n**Dependencies:** M0.\n\n---\n\n"
    )
    path = tmp_path / "ROADMAP.md"
    path.write_text(body, encoding="utf-8")
    return path
