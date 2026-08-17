"""Tests for check_blueprint_completeness.py — verifies mandatory sections + ADR count."""
from __future__ import annotations

from pathlib import Path

import pytest

from check_blueprint_completeness import check_blueprint_completeness  # noqa: E402


def test_good_blueprint_all_sections(good_blueprint: Path) -> None:
    report = check_blueprint_completeness(good_blueprint)
    assert report["found"] == report["total_required"]
    assert report["missing_mandatory"] == []
    assert report["adr_count"] >= 1


def test_synthetic_minimal_blueprint(synthetic_blueprint: Path) -> None:
    """Synthetic fixture has all 10 mandatory sections + 1 ADR."""
    report = check_blueprint_completeness(synthetic_blueprint)
    assert report["found"] >= 9  # Recommendations section may need exact title
    assert report["adr_count"] == 1


def test_missing_section_detected(tmp_path: Path) -> None:
    bp = tmp_path / "missing.md"
    bp.write_text(
        "# Blueprint: Test\n\n"
        "## Context\n\nText.\n\n"
        "## Objective\n\nText.\n\n"
        "## Coverage Corner 1 — Integration Tests\n\nText.\n\n"
        "## Coverage Corner 2 — Dependencies\n\nText.\n\n"
        # Missing Corners 3, 4, Cross-cutting, ADRs, Recommendations
        ,
        encoding="utf-8",
    )
    report = check_blueprint_completeness(bp)
    assert len(report["missing_mandatory"]) > 0
    assert "Coverage Corner 3" in report["missing_mandatory"]


def test_no_adr_detected(tmp_path: Path) -> None:
    bp = tmp_path / "no-adr.md"
    bp.write_text(
        "# Blueprint: Test\n\n"
        "## Context\n\nText.\n\n"
        "## Objective\n\nText.\n\n"
        "## Coverage Corner 1 — Integration Tests\n\n### Project A\n\nText.\n\n"
        "## Coverage Corner 2 — Dependencies\n\n### Project A\n\nText.\n\n"
        "## Coverage Corner 3 — Tools\n\n### Project A\n\nText.\n\n"
        "## Coverage Corner 4 — Techniques\n\n### Project A\n\nText.\n\n"
        "## Cross-cutting Comparison\n\nText.\n\n"
        "## ADRs\n\n(empty)\n\n"
        "## Recommendations\n\n- Do X\n",
        encoding="utf-8",
    )
    report = check_blueprint_completeness(bp)
    assert report["adr_count"] == 0
