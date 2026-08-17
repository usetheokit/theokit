"""Tests for select_next_milestone.py."""
from __future__ import annotations

from pathlib import Path

import pytest

from select_next_milestone import parse_roadmap, select


def test_parse_extracts_status_name_objective_dod_deps(roadmap_happy: Path) -> None:
    milestones = parse_roadmap(roadmap_happy.read_text(encoding="utf-8"))
    assert [m.id for m in milestones] == ["M0", "M1", "M2", "M3"]
    assert [m.status for m in milestones] == ["x", "x", " ", " "]
    m2 = next(m for m in milestones if m.id == "M2")
    assert m2.name == "Streaming"
    assert m2.objective == "SSE streaming for both providers."
    assert m2.dod == ["Streaming works.", "Cancel propagates."]
    assert m2.depends_on == ["M1"]


def test_select_picks_lowest_eligible(roadmap_happy: Path) -> None:
    milestones = parse_roadmap(roadmap_happy.read_text(encoding="utf-8"))
    result = select(milestones)
    assert result["milestone_id"] == "M2"
    assert result["name"] == "Streaming"
    assert result["depends_on"] == ["M1"]


def test_select_complete_when_all_done(roadmap_complete: Path) -> None:
    milestones = parse_roadmap(roadmap_complete.read_text(encoding="utf-8"))
    result = select(milestones)
    assert result == {"verdict": "ROADMAP_COMPLETE"}


def test_select_blocked_when_dependency_wall(roadmap_blocked: Path) -> None:
    milestones = parse_roadmap(roadmap_blocked.read_text(encoding="utf-8"))
    result = select(milestones)
    assert result["verdict"] == "ROADMAP_BLOCKED"
    assert len(result["wall"]) == 2
    assert all(entry["blocked_by"] for entry in result["wall"])


def test_select_prefer_returns_target_when_eligible(roadmap_happy: Path) -> None:
    milestones = parse_roadmap(roadmap_happy.read_text(encoding="utf-8"))
    result = select(milestones, prefer="M2")
    assert result["milestone_id"] == "M2"


def test_select_prefer_rejects_when_dependency_unchecked(roadmap_happy: Path) -> None:
    milestones = parse_roadmap(roadmap_happy.read_text(encoding="utf-8"))
    result = select(milestones, prefer="M3")
    assert result["verdict"] == "PREFER_NOT_ELIGIBLE"
    assert "M2" in result["reason"]


def test_select_prefer_rejects_when_already_done(roadmap_happy: Path) -> None:
    milestones = parse_roadmap(roadmap_happy.read_text(encoding="utf-8"))
    result = select(milestones, prefer="M0")
    assert result["verdict"] == "PREFER_NOT_ELIGIBLE"
    assert "already" in result["reason"]


def test_select_prefer_rejects_when_not_in_roadmap(roadmap_happy: Path) -> None:
    milestones = parse_roadmap(roadmap_happy.read_text(encoding="utf-8"))
    result = select(milestones, prefer="M99")
    assert result["verdict"] == "PREFER_NOT_ELIGIBLE"
    assert "not present" in result["reason"]


def test_parse_raises_on_empty_roadmap() -> None:
    with pytest.raises(ValueError, match="no milestone headers"):
        parse_roadmap("# Empty roadmap\n\nNo milestones here.\n")


def test_select_handles_cancelled_milestone(tmp_path: Path) -> None:
    body = (
        "### M0 — [x] Done\n\n**Objective:** d.\n\n"
        "**Definition of done:**\n\n- [x] x.\n\n**Dependencies:** none.\n\n---\n\n"
        "### M1 — [-] Cancelled\n\n**Objective:** dropped.\n\n"
        "**Definition of done:**\n\n- [ ] n/a.\n\n**Dependencies:** M0.\n\n---\n\n"
        "### M2 — [ ] Active\n\n**Objective:** next.\n\n"
        "**Definition of done:**\n\n- [ ] later.\n\n**Dependencies:** M0.\n\n---\n\n"
    )
    path = tmp_path / "ROADMAP.md"
    path.write_text(body, encoding="utf-8")
    result = select(parse_roadmap(path.read_text(encoding="utf-8")))
    assert result["milestone_id"] == "M2"
