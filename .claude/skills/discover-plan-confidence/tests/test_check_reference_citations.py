"""Tests for check_reference_citations.py — verifies .claude/knowledge-base/references/ citation path validation.

RED tests of T0.3. MUST fail with ModuleNotFoundError until T1.2 lands.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from check_reference_citations import check_reference_citations  # noqa: E402


def test_good_plan_all_citations_verified(tmp_path: Path) -> None:
    """A plan whose .claude/knowledge-base/references/ citations all resolve has zero fabrications.

    Hermetic: builds a self-contained project root under tmp_path with a `.claude/`
    dir (so the checker's walk-up resolves here, not the real repo) and creates the
    three cited reference paths on disk. This makes the existence assertions
    deterministic instead of depending on gitignored repo-resident clones.
    """
    # Arrange: tmp project root + the three cited reference paths on disk.
    references = tmp_path / ".claude" / "knowledge-base" / "references"
    for project in ("project-a", "project-b", "project-c"):
        (references / project).mkdir(parents=True, exist_ok=True)
    plan = tmp_path / "good-plan.md"
    plan.write_text(
        "# Discovery Plan\n\n"
        "Cite Project A: `.claude/knowledge-base/references/project-a/`\n"
        "Cite Project B: `.claude/knowledge-base/references/project-b/`\n"
        "Cite Project C: `.claude/knowledge-base/references/project-c/`\n",
        encoding="utf-8",
    )

    # Act
    report = check_reference_citations(plan)

    # Assert
    assert report["fabricated"] == 0
    assert report["verified"] >= 3


@pytest.fixture
def fabricated_citation_discover_plan(fixtures_dir: Path) -> Path:
    return fixtures_dir / "fabricated-citation-discover-plan.md"


def test_fabricated_citation_detected(fabricated_citation_discover_plan: Path) -> None:
    """The fabricated fixture has Q2's path NOT existing; checker MUST find it."""
    report = check_reference_citations(fabricated_citation_discover_plan)
    assert report["fabricated"] >= 1
    fabricated_str = " ".join(report["fabricated_paths"])
    assert "this-path-does-not-exist-2026" in fabricated_str


def test_blocked_marker_excludes_from_fabricated(fabricated_citation_discover_plan: Path) -> None:
    """Citations immediately followed by a BLOCKED marker are documented gaps, not fabrications."""
    report = check_reference_citations(fabricated_citation_discover_plan)
    assert report["explicitly_blocked"] >= 1
    blocked_str = " ".join(report["blocked_paths"])
    assert "intentionally-missing-2026" in blocked_str


def test_citation_density_computed(good_discover_plan: Path) -> None:
    """citation_density_per_200w is a positive float when citations exist."""
    report = check_reference_citations(good_discover_plan)
    assert report["total"] > 0
    assert isinstance(report["citation_density_per_200w"], float)
    assert report["citation_density_per_200w"] > 0
