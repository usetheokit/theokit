"""Shared pytest fixtures for release tests."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).parent.parent
SCRIPTS_DIR = SKILL_ROOT / "scripts"

sys.path.insert(0, str(SCRIPTS_DIR))


@pytest.fixture
def roadmap_pre_flip(tmp_path: Path) -> Path:
    """Roadmap with M0 [x], M1 [x], M2 [ ], M3 [ ] (target for flip = M2)."""
    body = (
        "# Test Roadmap\n\n"
        "### M0 — [x] Skeleton\n\n**Objective:** done.\n\n"
        "**Definition of done:**\n\n- [x] live.\n\n**Dependencies:** none.\n\n---\n\n"
        "### M1 — [x] Auth\n\n**Objective:** done.\n\n"
        "**Definition of done:**\n\n- [x] shipped.\n\n**Dependencies:** M0.\n\n---\n\n"
        "### M2 — [ ] Streaming\n\n**Objective:** sse.\n\n"
        "**Definition of done:**\n\n- [ ] later.\n\n**Dependencies:** M1.\n\n---\n\n"
        "### M3 — [ ] Quotas\n\n**Objective:** quota.\n\n"
        "**Definition of done:**\n\n- [ ] later.\n\n**Dependencies:** M2.\n\n---\n\n"
    )
    path = tmp_path / "ROADMAP.md"
    path.write_text(body, encoding="utf-8")
    return path
