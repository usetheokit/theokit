"""Tests for check_research_coverage.py — verifies the 4-corner check."""
from __future__ import annotations

from pathlib import Path

import pytest

from check_research_coverage import check_research_coverage  # noqa: E402


def test_good_blueprint_all_corners_populated(good_blueprint: Path) -> None:
    report = check_research_coverage(good_blueprint)
    assert report["corners_populated"] == 4
    assert report["corners_total"] == 4
    assert report["empty_corners"] == []


def test_synthetic_blueprint_minimal_passes(synthetic_blueprint: Path) -> None:
    report = check_research_coverage(synthetic_blueprint)
    assert report["corners_populated"] == 4
    assert report["empty_corners"] == []


def test_missing_corner_detected(tmp_path: Path) -> None:
    long_content = (
        "Real substantive content describing the corner with enough text to pass the "
        "MIN_CONTENT_CHARS threshold required by the checker. " * 2
    )
    bp = tmp_path / "missing-tests.md"
    bp.write_text(
        "# Blueprint: Test\n\n"
        f"## Coverage Corner 2 — Dependencies\n\n### X\n\n{long_content}\n\n"
        f"## Coverage Corner 3 — Tools\n\n### X\n\n{long_content}\n\n"
        f"## Coverage Corner 4 — Techniques\n\n### X\n\n{long_content}\n",
        encoding="utf-8",
    )
    report = check_research_coverage(bp)
    assert report["corners_populated"] == 3
    assert "tests" in report["empty_corners"]


def test_placeholder_section_not_populated(tmp_path: Path) -> None:
    long_content = (
        "Real substantive content describing the corner with enough text to pass the "
        "MIN_CONTENT_CHARS threshold required by the checker. " * 2
    )
    bp = tmp_path / "tbd-blueprint.md"
    bp.write_text(
        "# Blueprint: Test\n\n"
        "## Coverage Corner 1 — Integration Tests\n\n"
        "### Project A\n\n<!-- TBD: Q1 -->\n\n"
        f"## Coverage Corner 2 — Dependencies\n\n### X\n\n{long_content}\n\n"
        f"## Coverage Corner 3 — Tools\n\n### X\n\n{long_content}\n\n"
        f"## Coverage Corner 4 — Techniques\n\n### X\n\n{long_content}\n",
        encoding="utf-8",
    )
    report = check_research_coverage(bp)
    assert "tests" in report["empty_corners"]


def test_deferred_marker_counts_as_populated(tmp_path: Path) -> None:
    long_content = (
        "Real substantive content describing the corner with enough text to pass the "
        "MIN_CONTENT_CHARS threshold required by the checker. " * 2
    )
    bp = tmp_path / "deferred.md"
    bp.write_text(
        "# Blueprint: Test\n\n"
        "## Coverage Corner 1 — Integration Tests\n\n"
        "### Project A\n\n<!-- DEFERRED: tests deferred to v0.4 -->\n\n"
        f"## Coverage Corner 2 — Dependencies\n\n### X\n\n{long_content}\n\n"
        f"## Coverage Corner 3 — Tools\n\n### X\n\n{long_content}\n\n"
        f"## Coverage Corner 4 — Techniques\n\n### X\n\n{long_content}\n",
        encoding="utf-8",
    )
    report = check_research_coverage(bp)
    assert report["corners_populated"] == 4
    assert report["empty_corners"] == []
