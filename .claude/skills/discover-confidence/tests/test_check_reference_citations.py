"""Tests for check_reference_citations.py — verifies fabricated-citation hard cap."""
from __future__ import annotations

from pathlib import Path

import pytest

from check_reference_citations import check_reference_citations  # noqa: E402


def test_good_blueprint_all_citations_verified(tmp_path: Path) -> None:
    """A blueprint citing EXISTING .claude/knowledge-base/references/ paths yields
    verified > 0 and fabricated == 0.

    Hermetic: the cited reference file is created under a tmp project root whose
    .claude/ dir anchors _find_project_root's walk-up. The test must not depend on
    repo-resident (gitignored/absent) .claude/knowledge-base/references/** files.
    """
    # Arrange: build a self-contained project root with a real reference file.
    project_root = tmp_path / "project"
    ref_file = project_root / ".claude" / "knowledge-base" / "references" / "project-a" / "README.md"
    ref_file.parent.mkdir(parents=True, exist_ok=True)
    ref_file.write_text("# Project A reference\n", encoding="utf-8")

    bp = project_root / "blueprint.md"
    bp.write_text(
        "# Blueprint: Test\n\n"
        "We cite a real path: .claude/knowledge-base/references/project-a/README.md\n",
        encoding="utf-8",
    )

    # Act: anchor the lookup to our tmp root so existence checks are deterministic.
    import check_reference_citations as crc

    original_find_root = crc._find_project_root
    crc._find_project_root = lambda _start: project_root
    try:
        report = check_reference_citations(bp)
    finally:
        crc._find_project_root = original_find_root

    # Assert
    assert report["fabricated"] == 0
    assert report["verified"] > 0


def test_synthetic_no_citations_passes(synthetic_blueprint: Path) -> None:
    """When blueprint has zero .claude/knowledge-base/references/ citations, that's not a failure."""
    report = check_reference_citations(synthetic_blueprint)
    assert report["total"] == 0
    assert report["fabricated"] == 0


def test_fabricated_citation_detected(tmp_path: Path, project_root: Path) -> None:
    bp = tmp_path / "fab.md"
    bp.write_text(
        "# Blueprint: Test\n\n"
        "We cite a fake path: .claude/knowledge-base/references/project-a/this-does-not-exist.py:42\n",
        encoding="utf-8",
    )
    # Use the real project root so the path lookup is consistent
    import check_reference_citations as crc
    original_find_root = crc._find_project_root
    crc._find_project_root = lambda x: project_root
    try:
        report = check_reference_citations(bp)
    finally:
        crc._find_project_root = original_find_root

    assert report["fabricated"] >= 1
    assert any("does-not-exist" in p for p in report["fabricated_paths"])


def test_blocked_citation_not_counted_as_fabricated(tmp_path: Path, project_root: Path) -> None:
    """When a fabricated citation is marked <!-- BLOCKED: ... -->, it's an honest gap, not fabrication."""
    bp = tmp_path / "blocked.md"
    bp.write_text(
        "# Blueprint: Test\n\n"
        "We cite a fake path: .claude/knowledge-base/references/project-a/this-does-not-exist.py:42 <!-- BLOCKED: path not found in .claude/knowledge-base/references/ -->\n",
        encoding="utf-8",
    )
    import check_reference_citations as crc
    original_find_root = crc._find_project_root
    crc._find_project_root = lambda x: project_root
    try:
        report = check_reference_citations(bp)
    finally:
        crc._find_project_root = original_find_root

    assert report["fabricated"] == 0
    assert report["explicitly_blocked"] == 1
