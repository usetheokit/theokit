"""Shared pytest fixtures for acceptance tests."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).parent.parent
SCRIPTS_DIR = SKILL_ROOT / "scripts"

sys.path.insert(0, str(SCRIPTS_DIR))


@pytest.fixture
def roadmap_text() -> str:
    """M1 released with a 2-bullet DoD; M2 open with a 3-bullet DoD; M3 has no DoD."""
    return (
        "# Roadmap\n\n"
        "### M1 — [x] Auth\n\n"
        "**Objective:** login.\n\n"
        "**Definition of done (all must hold):**\n\n"
        "- [x] User signs in with e-mail.\n"
        "- [x] Session survives a reload.\n\n"
        "**Dependencies:** none.\n\n---\n\n"
        "### M2 — [ ] Streaming\n\n"
        "**Objective:** sse.\n\n"
        "**Definition of done (all must hold):**\n\n"
        "- [ ] Response streams token by token.\n"
        "- [ ] Cancelling stops the stream within 1s.\n"
        "- [ ] A dropped connection resumes without data loss.\n\n"
        "**Dependencies:** M1.\n\n"
        "**Top risks:**\n\n1. Proxy buffering.\n\n---\n\n"
        "### M3 — [ ] Quotas\n\n"
        "**Objective:** quota.\n\n"
        "**Dependencies:** M2.\n\n---\n\n"
    )


@pytest.fixture
def criteria_m2() -> list[dict]:
    return [
        {"id": "AC1", "source": "roadmap-dod", "text": "Response streams token by token."},
        {"id": "AC2", "source": "roadmap-dod", "text": "Cancelling stops the stream within 1s."},
    ]


@pytest.fixture
def passing_results() -> list[dict]:
    return [
        {"id": "AC1", "status": "passed", "evidence": ["evidence/M2-AC1.png"]},
        {"id": "AC2", "status": "passed", "evidence": ["evidence/M2-AC2.png"]},
    ]
