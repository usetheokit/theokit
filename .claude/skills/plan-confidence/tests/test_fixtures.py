"""T4.4 — fixtures validation."""
from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from run_structural import run_structural  # noqa: E402

SKILL_ROOT = Path(__file__).parent.parent
FIXTURES = SKILL_ROOT / "fixtures"
RUBRIC = SKILL_ROOT / "templates" / "rubric-v1.md"
THRESHOLDS = SKILL_ROOT.parent.parent / "rules" / "plan-confidence-thresholds.txt"

EXPECTED_FIXTURES = [
    "good-plan.md",
    "missing-coverage-plan.md",
    "weak-imperatives-plan.md",
    "no-tdd-plan.md",
]


def test_all_fixtures_exist() -> None:
    for name in EXPECTED_FIXTURES:
        assert (FIXTURES / name).exists(), f"missing fixture: {name}"


def test_fixtures_under_size_limit() -> None:
    for name in EXPECTED_FIXTURES:
        path = FIXTURES / name
        lines = len(path.read_text(encoding="utf-8").splitlines())
        assert lines <= 200, f"{name} has {lines} lines (max 200; spec says 50-150)"


def test_fixture_good_plan_does_not_trigger_caps() -> None:
    report = run_structural(FIXTURES / "good-plan.md", RUBRIC, THRESHOLDS)
    assert report.hard_caps_triggered == [], f"good fixture triggered caps: {report.hard_caps_triggered}"


def test_fixture_missing_coverage_triggers_coverage_cap() -> None:
    report = run_structural(FIXTURES / "missing-coverage-plan.md", RUBRIC, THRESHOLDS)
    assert "coverage_lt_100" in report.hard_caps_triggered
    assert report.verdict == "INVALID"


def test_fixture_weak_imperatives_reduces_risco() -> None:
    report = run_structural(FIXTURES / "weak-imperatives-plan.md", RUBRIC, THRESHOLDS)
    assert report.risco_estrutural_score < 100


def test_fixture_no_tdd_triggers_tdd_cap() -> None:
    report = run_structural(FIXTURES / "no-tdd-plan.md", RUBRIC, THRESHOLDS)
    assert "bugfix_without_tdd" in report.hard_caps_triggered
    assert report.final_score_after_caps <= 70
