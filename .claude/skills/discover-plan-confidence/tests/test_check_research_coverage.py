"""Tests for check_research_coverage.py — verifies the 4-corner check on discovery plans.

These are the RED tests of T0.2. They MUST fail with ModuleNotFoundError until T1.1
lands the implementation at scripts/check_research_coverage.py.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from check_research_coverage import check_research_coverage  # noqa: E402


def test_good_plan_all_corners_populated(good_discover_plan: Path) -> None:
    report = check_research_coverage(good_discover_plan)
    assert report["corners_populated"] == 4
    assert report["corners_total"] == 4
    assert report["empty_corners"] == []


def test_missing_corner_detected_in_matrix(missing_corner_discover_plan: Path) -> None:
    report = check_research_coverage(missing_corner_discover_plan)
    assert report["corners_populated"] == 3
    assert "tests" in report["empty_corners"]


def test_defer_corner_marker_counts_as_populated(tmp_path: Path) -> None:
    """A corner with no questions but a DEFER-CORNER marker per D5 counts as populated."""
    body = (
        "# Discovery Plan: Defer Test\n\n"
        "**Slug:** `defer`\n\n"
        "## Context\n\nDeferral test fixture.\n\n"
        "## Objective\n\nVerify DEFER-CORNER marker honored.\n\n"
        "## In-Scope / Out-of-Scope\n\n| P | In | Why |\n|---|---|---|\n| `.claude/knowledge-base/references/project-a/` | x | y |\n\n"
        "## ADRs\n\n### D1 — Budget\n\n**Decision:** 1h.\n\n### D2 — Depth\n\n**Decision:** skim.\n\n"
        "## Research Questions\n\n"
        "| # | Question | Corner | Reference project(s) | Fase A | Fase B | Expected answer shape |\n"
        "|---|---|---|---|---|---|---|\n"
        "| Q1 | deps q | deps | `.claude/knowledge-base/references/project-a/` | SKIP | Read | text |\n"
        "| Q2 | tools q | tools | `.claude/knowledge-base/references/project-a/` | SKIP | Read | text |\n"
        "| Q3 | tech q | techniques | `.claude/knowledge-base/references/project-a/` | ast-grep | Read | text |\n"
        "| Q4 | tech q2 | techniques | `.claude/knowledge-base/references/project-a/` | ast-grep | Read | text |\n"
        "| Q5 | tech q3 | techniques | `.claude/knowledge-base/references/project-a/` | ast-grep | Read | text |\n\n"
        "## Coverage Matrix\n\n"
        "| Corner | Questions mapped | Status |\n"
        "|---|---|---|\n"
        "| Integration tests | (none) | <!-- DEFER-CORNER: tests | per D2, tests out of scope for v0.0 --> |\n"
        "| Dependencies | Q1 | Covered |\n"
        "| Tools | Q2 | Covered |\n"
        "| Techniques | Q3, Q4, Q5 | Covered |\n\n"
        "## Halt-loop Checkpoints\n\n| C | A | Fail |\n|---|---|---|\n| x | y | z |\n\n"
        "## Acceptance Criteria\n\n- [ ] x\n\n"
        "## Global Definition of Done\n\n- [ ] x\n"
    )
    plan = tmp_path / "defer.md"
    plan.write_text(body, encoding="utf-8")

    report = check_research_coverage(plan)

    assert report["corners_populated"] == 4
    assert report["empty_corners"] == []


def test_placeholder_text_not_populated(tmp_path: Path) -> None:
    """A corner whose only entry is a TBD placeholder MUST NOT count as populated."""
    body = (
        "# Discovery Plan: TBD Test\n\n"
        "**Slug:** `tbd`\n\n"
        "## Context\n\nx\n\n## Objective\n\nx\n\n"
        "## In-Scope / Out-of-Scope\n\n| P | In | Why |\n|---|---|---|\n| `.claude/knowledge-base/references/project-a/` | x | y |\n\n"
        "## ADRs\n\n### D1 — x\n\n**Decision:** x.\n\n### D2 — x\n\n**Decision:** x.\n\n"
        "## Research Questions\n\n"
        "| # | Question | Corner | Reference project(s) | Fase A | Fase B | Expected answer shape |\n"
        "|---|---|---|---|---|---|---|\n"
        "| Q1 | deps q | deps | `.claude/knowledge-base/references/project-a/` | SKIP | Read | text |\n"
        "| Q2 | tools q | tools | `.claude/knowledge-base/references/project-a/` | SKIP | Read | text |\n"
        "| Q3 | tech q | techniques | `.claude/knowledge-base/references/project-a/` | ast-grep | Read | text |\n"
        "| Q4 | tech q2 | techniques | `.claude/knowledge-base/references/project-a/` | ast-grep | Read | text |\n"
        "| Q5 | tech q3 | techniques | `.claude/knowledge-base/references/project-a/` | ast-grep | Read | text |\n\n"
        "## Coverage Matrix\n\n"
        "| Corner | Questions mapped | Status |\n"
        "|---|---|---|\n"
        "| Integration tests | <!-- TBD: figure out later --> | TBD |\n"
        "| Dependencies | Q1 | Covered |\n"
        "| Tools | Q2 | Covered |\n"
        "| Techniques | Q3, Q4, Q5 | Covered |\n\n"
        "## Halt-loop Checkpoints\n\n| C | A | Fail |\n|---|---|---|\n| x | y | z |\n\n"
        "## Acceptance Criteria\n\n- [ ] x\n\n"
        "## Global Definition of Done\n\n- [ ] x\n"
    )
    plan = tmp_path / "tbd.md"
    plan.write_text(body, encoding="utf-8")

    report = check_research_coverage(plan)

    assert "tests" in report["empty_corners"]


def test_questions_table_missing_corner_detected(missing_corner_discover_plan: Path) -> None:
    """When Research Questions table has zero rows for a corner AND no DEFER-CORNER marker,
    the corner counts as empty even if the Coverage Matrix row exists.
    """
    report = check_research_coverage(missing_corner_discover_plan)
    assert "tests" in report["empty_corners"]
    statuses = {c["corner"]: c for c in report["corners_status"]}
    assert statuses["tests"]["populated"] is False
