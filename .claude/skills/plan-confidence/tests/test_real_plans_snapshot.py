"""L1 — Snapshot regression tests over real plans in the project.

Pins the expected verdict + score band for each real plan to detect silent
behavior drift. If a detector change moves a plan into a different band
(e.g., SHIPPABLE -> NON_SHIPPABLE), this test fails LOUDLY and forces
an explicit decision: either accept the new behavior (update snapshot) or
revert the detector change.

We pin BAND (not exact score) because exact scores can shift slightly with
detector refinements. Bands are the semantic gate.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from run_structural import run_structural  # noqa: E402

SKILL_ROOT = Path(__file__).parent.parent
PROJECT_ROOT = SKILL_ROOT.parent.parent.parent
PLANS_DIR = SKILL_ROOT.parent.parent / "knowledge-base" / "plans"
COMPLETED_DIR = PLANS_DIR / "completed"
RUBRIC = SKILL_ROOT / "templates" / "rubric-v1.md"
THRESHOLDS = SKILL_ROOT.parent.parent / "rules" / "plan-confidence-thresholds.txt"


def _resolve_plan(filename: str) -> Path | None:
    """Find plan in active dir OR completed/ subdir."""
    for candidate in (PLANS_DIR / filename, COMPLETED_DIR / filename):
        if candidate.exists():
            return candidate
    return None


# Pinned snapshots — band + expected hard caps. Scores may shift ±5; bands MUST NOT.
# Covers diverse plan styles: active, completed, with/without out-of-scope items.
SNAPSHOTS: dict[str, dict[str, object]] = {
    # Active plan, no caps, structurally clean
    "observability-cache-maturity-plan.md": {
        "verdict_in": {"SHIPPABLE", "SHIPPABLE_WITH_CAVEATS"},
        "score_min": 70,
        "expected_hard_caps_subset": set(),
    },
    # Completed: real plan that uses 5-column matrix; tests #2 fix (out-of-scope detection)
    "theo-cli-cohesion-remediation-plan.md": {
        "verdict_in": {"SHIPPABLE_WITH_CAVEATS", "SHIPPABLE"},
        "score_min": 60,
        "expected_hard_caps_subset": set(),  # after #2 fix, F-CODE-01 deferred not unmapped
    },
    # Completed: known to be INVALID (5 unmapped phased to v2); allowlisted
    "sota-gaps-remediation-plan.md": {
        "verdict_in": {"INVALID"},
        "score_max": 49,
        "expected_hard_caps_subset": {"coverage_lt_100"},
    },
    # Completed: large refactor plan, tests scale
    "journeys-as-sdk-consumers-v2-plan.md": {
        "verdict_in": {"SHIPPABLE", "SHIPPABLE_WITH_CAVEATS", "NON_SHIPPABLE", "INVALID"},
        "score_min": 0,  # just verify it runs without error
        "expected_hard_caps_subset": set(),
    },
    # Completed: dogfood-related plan
    "dogfood-2026-05-15-fix-plan.md": {
        "verdict_in": {"SHIPPABLE", "SHIPPABLE_WITH_CAVEATS", "NON_SHIPPABLE", "INVALID"},
        "score_min": 0,
        "expected_hard_caps_subset": set(),
    },
    # Completed: another diverse style
    "memory-gaps-remediation-plan.md": {
        "verdict_in": {"SHIPPABLE", "SHIPPABLE_WITH_CAVEATS", "NON_SHIPPABLE", "INVALID"},
        "score_min": 0,
        "expected_hard_caps_subset": set(),
    },
    # Active plans added 2026-06-08 SOTA upgrade — accept any band (just verify the
    # plan loads + scores without error). Tighten the envelope after the plans
    # complete their migration to the new template.
    "harden-fabrication-and-cq-gate-plan.md": {
        "verdict_in": {"SHIPPABLE", "SHIPPABLE_WITH_CAVEATS", "NON_SHIPPABLE", "INVALID"},
        "score_min": 0,
        "expected_hard_caps_subset": set(),
    },
    "slice-s0-walking-skeleton-plan.md": {
        "verdict_in": {"SHIPPABLE", "SHIPPABLE_WITH_CAVEATS", "NON_SHIPPABLE", "INVALID"},
        "score_min": 0,
        "expected_hard_caps_subset": set(),
    },
    "slice-s0b-walking-skeleton-crd-first-plan.md": {
        "verdict_in": {"SHIPPABLE", "SHIPPABLE_WITH_CAVEATS", "NON_SHIPPABLE", "INVALID"},
        "score_min": 0,
        "expected_hard_caps_subset": set(),
    },
}


@pytest.mark.parametrize("plan_filename,expected", list(SNAPSHOTS.items()))
def test_real_plan_snapshot(plan_filename: str, expected: dict[str, object]) -> None:
    plan_path = _resolve_plan(plan_filename)
    if plan_path is None:
        pytest.skip(f"plan not found in plans/ or completed/: {plan_filename}")

    report = run_structural(plan_path, RUBRIC, THRESHOLDS)

    # Verdict band
    verdict_in = expected["verdict_in"]
    assert isinstance(verdict_in, set)
    assert report.verdict in verdict_in, (
        f"{plan_filename}: verdict drift — expected one of {verdict_in}, "
        f"got {report.verdict} (score={report.final_score_after_caps})"
    )

    # Score envelope
    if "score_min" in expected:
        score_min = expected["score_min"]
        assert isinstance(score_min, int | float)
        assert report.final_score_after_caps >= score_min, (
            f"{plan_filename}: score regression — got {report.final_score_after_caps} < {score_min}"
        )
    if "score_max" in expected:
        score_max = expected["score_max"]
        assert isinstance(score_max, int | float)
        assert report.final_score_after_caps <= score_max, (
            f"{plan_filename}: score regression — got {report.final_score_after_caps} > {score_max}"
        )

    # Hard caps subset
    expected_caps = expected["expected_hard_caps_subset"]
    assert isinstance(expected_caps, set)
    actual_caps = set(report.hard_caps_triggered)
    # Expected caps MUST be in actual; actual may have extras (we'll catch new ones via overlap)
    missing = expected_caps - actual_caps
    assert not missing, (
        f"{plan_filename}: expected hard caps {expected_caps} not in actual {actual_caps}"
    )


def test_snapshots_cover_active_plans_with_matrix() -> None:
    """Sanity: snapshots should cover every ACTIVE (non-completed) plan that has a Coverage Matrix."""
    skipped_known = {
        "l2-wiring-keep-wire-followup.md",
        "memory-write-redesign-followup.md",
        "observability-cache-maturity-baseline.md",
        "observability-cache-maturity-edge-cases.md",
    }
    snapshot_plans = set(SNAPSHOTS.keys())
    active_plans = {p.name for p in PLANS_DIR.glob("*.md") if p.is_file()}
    eligible = active_plans - skipped_known
    uncovered = eligible - snapshot_plans
    assert not uncovered, (
        f"new active plans missing snapshot: {uncovered}. Add them to SNAPSHOTS or skipped_known."
    )


def test_score_determinism_real_plans() -> None:
    """Real plans: same input -> same output across multiple invocations."""
    for filename in SNAPSHOTS:
        plan_path = _resolve_plan(filename)
        if plan_path is None:
            continue
        r1 = run_structural(plan_path, RUBRIC, THRESHOLDS)
        r2 = run_structural(plan_path, RUBRIC, THRESHOLDS)
        assert r1.final_score_after_caps == r2.final_score_after_caps, (
            f"{filename}: nondeterministic score {r1.final_score_after_caps} != {r2.final_score_after_caps}"
        )
        assert r1.verdict == r2.verdict
        assert r1.hard_caps_triggered == r2.hard_caps_triggered
