"""Shared pytest fixtures for cycle-goal tests."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).parent.parent
SCRIPTS_DIR = SKILL_ROOT / "scripts"

sys.path.insert(0, str(SCRIPTS_DIR))


@pytest.fixture
def roadmap_text() -> str:
    """M0/M1 released, M2/M3/M4 open. M3 depends on M2; M4 depends on M3."""
    return (
        "# Test Roadmap\n\n"
        "### M0 — [x] Skeleton\n\n**Objective:** done.\n\n"
        "**Dependencies:** none.\n\n---\n\n"
        "### M1 — [x] Auth\n\n**Objective:** done.\n\n"
        "**Dependencies:** M0.\n\n---\n\n"
        "### M2 — [ ] Streaming\n\n**Objective:** sse.\n\n"
        "**Dependencies:** M1.\n\n---\n\n"
        "### M3 — [ ] Quotas\n\n**Objective:** quota.\n\n"
        "**Dependencies:** M2.\n\n---\n\n"
        "### M4 — [ ] Billing\n\n**Objective:** invoices.\n\n"
        "**Dependencies:** M3.\n\n---\n\n"
    )


@pytest.fixture
def roadmap(tmp_path: Path, roadmap_text: str) -> Path:
    path = tmp_path / "ROADMAP.md"
    path.write_text(roadmap_text, encoding="utf-8")
    return path
