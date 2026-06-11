"""Tests for check_reference_citations.py — verifies fabricated-citation hard cap."""
from __future__ import annotations

from pathlib import Path

import pytest

from check_reference_citations import check_reference_citations  # noqa: E402


def test_good_blueprint_all_citations_verified(good_blueprint: Path) -> None:
    report = check_reference_citations(good_blueprint)
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
