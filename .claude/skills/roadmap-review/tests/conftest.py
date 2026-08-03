"""Shared pytest fixtures for roadmap-review tests."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).parent.parent
SCRIPTS_DIR = SKILL_ROOT / "scripts"
REPO_ROOT = SKILL_ROOT.parent.parent

sys.path.insert(0, str(SCRIPTS_DIR))

#: The reference examples roadmap-init ships. They are the strongest available oracle:
#: whatever this reviewer decides, it must approve the one and reject the other.
GOOD_FIXTURE = REPO_ROOT / "skills/roadmap-init/fixtures/good-roadmap-ai-gateway.md"
BAD_FIXTURE = REPO_ROOT / "skills/roadmap-init/fixtures/bad-roadmap-vague-milestones.md"


def milestone(
    milestone_id: str = "M1",
    name: str = "Multi-provider abstraction",
    state: str = " ",
    dod: tuple[str, ...] = ("P95 latency stays under 50ms.", "Failover covered by an integration test."),
    dependencies: str | None = "M0",
) -> str:
    """Build one well-formed milestone block."""
    block = f"### {milestone_id} — [{state}] {name}\n\n**Objective:** something concrete.\n\n"
    if dod:
        block += "**Definition of done (all must hold):**\n\n"
        block += "".join(f"- [ ] {bullet}\n" for bullet in dod)
        block += "\n"
    if dependencies is not None:
        block += f"**Dependencies:** {dependencies}.\n\n"
    return block + "---\n\n"


def roadmap(*milestone_blocks: str, sections: bool = True) -> str:
    """Assemble a document with the required top-level sections plus the given milestones."""
    head = ""
    if sections:
        head = (
            "# Test — Roadmap\n\n"
            "## Vision\n\nConcrete vision.\n\n"
            "## Problem\n\nConcrete pain, named owner.\n\n"
            "## Users\n\nPlatform team.\n\n"
            "## Scope\n\n### In scope\n\n- A deliverable.\n\n"
            "### Explicitly out of scope\n\n- Something deliberately excluded.\n\n"
            "## Constraints\n\n- Runs on the existing cluster.\n\n"
            "## Success criteria\n\nTwo teams in production for 4 weeks.\n\n"
            "## Milestones\n\n"
        )
    return head + "".join(milestone_blocks)


@pytest.fixture
def make_milestone():
    """Factory for one well-formed milestone block."""
    return milestone


@pytest.fixture
def make_roadmap():
    """Factory for a document with the required sections plus the given milestones."""
    return roadmap


@pytest.fixture
def good_text() -> str:
    return GOOD_FIXTURE.read_text(encoding="utf-8")


@pytest.fixture
def bad_text() -> str:
    return BAD_FIXTURE.read_text(encoding="utf-8")


@pytest.fixture
def healthy() -> str:
    """A roadmap with nothing wrong with it."""
    return roadmap(
        milestone("M0", "Walking skeleton", dependencies="none"),
        milestone("M1", "Multi-provider abstraction", dependencies="M0"),
    )
