"""Tests for check_plan_completeness.py — verifies mandatory sections + question budget +
method per Q + ADR count on discovery plans.

RED tests of T0.4. MUST fail with ModuleNotFoundError until T1.3 lands.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from check_plan_completeness import check_plan_completeness  # noqa: E402


def _build_plan(tmp_path: Path, name: str, body: str) -> Path:
    plan = tmp_path / name
    plan.write_text(body, encoding="utf-8")
    return plan


@pytest.fixture
def under_budget_plan(fixtures_dir: Path) -> Path:
    return fixtures_dir / "under-budget-discover-plan.md"


@pytest.fixture
def method_missing_plan(fixtures_dir: Path) -> Path:
    return fixtures_dir / "method-missing-discover-plan.md"


@pytest.fixture
def no_adrs_plan(fixtures_dir: Path) -> Path:
    return fixtures_dir / "no-adrs-discover-plan.md"


def test_good_plan_all_sections_present(good_discover_plan: Path) -> None:
    """good-discover-plan.md has all 10 mandatory sections + 2 ADRs."""
    report = check_plan_completeness(good_discover_plan)
    assert report["found"] == report["total_required"]
    assert report["missing_mandatory"] == []
    assert report["adr_count"] >= 2
    assert report["budget_violations"] == []
    assert report["methodless_questions"] == []


def test_missing_section_detected(tmp_path: Path, good_discover_plan: Path) -> None:
    """Removing the Halt-loop Checkpoints section MUST surface it in missing_mandatory."""
    text = good_discover_plan.read_text(encoding="utf-8")
    truncated = text.split("## Halt-loop Checkpoints")[0] + text.split("## Acceptance Criteria")[1].join(["## Acceptance Criteria", ""])
    plan = _build_plan(tmp_path, "no-halt-checkpoints.md", truncated)
    report = check_plan_completeness(plan)
    assert any("Halt" in m for m in report["missing_mandatory"])


def test_question_count_below_min_detected(under_budget_plan: Path) -> None:
    """4 Qs is below the 5-10 budget."""
    report = check_plan_completeness(under_budget_plan)
    assert any("too_few" in v for v in report["budget_violations"])


def test_question_count_above_max_detected(tmp_path: Path) -> None:
    """11 Qs is above the 5-10 budget. Build a synthetic plan inline."""
    rows = "\n".join(
        f"| Q{i} | q | tests | `.claude/knowledge-base/references/project-a/` | SKIP | Read | text |" for i in range(1, 12)
    )
    body = (
        "# Discovery Plan: Over Budget\n\n## Context\n\nx\n\n## Objective\n\nx\n\n"
        "## In-Scope / Out-of-Scope\n\n| P | In | Why |\n|---|---|---|\n| `.claude/knowledge-base/references/project-a/` | x | y |\n\n"
        "## ADRs\n\n### D1 — x\n\n**Decision:** x.\n\n### D2 — x\n\n**Decision:** x.\n\n"
        "## Research Questions\n\n"
        "| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |\n"
        "|---|---|---|---|---|---|---|\n"
        f"{rows}\n\n"
        "## Coverage Matrix\n\n| Corner | Q | Status |\n|---|---|---|\n| Integration tests | Q1 | x |\n"
        "| Dependencies | Q2 | <!-- DEFER-CORNER: deps | x --> |\n"
        "| Tools | Q3 | <!-- DEFER-CORNER: tools | x --> |\n"
        "| Techniques | Q4 | <!-- DEFER-CORNER: techniques | x --> |\n\n"
        "## Halt-loop Checkpoints\n\n| C | A | F |\n|---|---|---|\n| x | y | z |\n\n"
        "## Acceptance Criteria\n\n- [ ] x\n\n## Global Definition of Done\n\n- [ ] x\n"
    )
    plan = _build_plan(tmp_path, "over.md", body)
    report = check_plan_completeness(plan)
    assert any("too_many" in v for v in report["budget_violations"])


def test_per_corner_max_exceeded_detected(tmp_path: Path) -> None:
    """4 Qs in one corner (tests) violates per-corner max (3)."""
    rows = "\n".join(
        f"| Q{i} | q | tests | `.claude/knowledge-base/references/project-a/` | SKIP | Read | text |" for i in range(1, 5)
    )
    body = (
        "# Discovery Plan: Corner Overflow\n\n## Context\n\nx\n\n## Objective\n\nx\n\n"
        "## In-Scope / Out-of-Scope\n\n| P | In | Why |\n|---|---|---|\n| `.claude/knowledge-base/references/project-a/` | x | y |\n\n"
        "## ADRs\n\n### D1 — x\n\n**Decision:** x.\n\n### D2 — x\n\n**Decision:** x.\n\n"
        "## Research Questions\n\n"
        "| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |\n"
        "|---|---|---|---|---|---|---|\n"
        f"{rows}\n"
        "| Q5 | q | deps | `.claude/knowledge-base/references/project-a/` | SKIP | Read | text |\n\n"
        "## Coverage Matrix\n\n| Corner | Q | Status |\n|---|---|---|\n"
        "| Integration tests | Q1, Q2, Q3, Q4 | x |\n"
        "| Dependencies | Q5 | x |\n"
        "| Tools | (none) | <!-- DEFER-CORNER: tools | x --> |\n"
        "| Techniques | (none) | <!-- DEFER-CORNER: techniques | x --> |\n\n"
        "## Halt-loop Checkpoints\n\n| C | A | F |\n|---|---|---|\n| x | y | z |\n\n"
        "## Acceptance Criteria\n\n- [ ] x\n\n## Global Definition of Done\n\n- [ ] x\n"
    )
    plan = _build_plan(tmp_path, "overflow.md", body)
    report = check_plan_completeness(plan)
    assert any("corner_overflow_tests" in v for v in report["budget_violations"])


def test_methodless_question_detected(method_missing_plan: Path) -> None:
    """Q3 in the fixture has empty Fase A (not SKIP) — must surface in methodless_questions."""
    report = check_plan_completeness(method_missing_plan)
    assert "Q3" in report["methodless_questions"]


def test_skip_token_allowed_in_fase_a(good_discover_plan: Path) -> None:
    """Fase A == 'SKIP' is the text-shape exemption — MUST NOT count as methodless."""
    report = check_plan_completeness(good_discover_plan)
    assert report["methodless_questions"] == []


def test_adr_count_below_two_detected(no_adrs_plan: Path) -> None:
    """The no-adrs fixture has ## ADRs header but zero ### D1/D2 entries."""
    report = check_plan_completeness(no_adrs_plan)
    assert report["adr_count"] < 2
