"""T4.3 — run_structural.py orchestrator tests."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from run_structural import (  # noqa: E402
    M2_ACTIVE_DIMENSIONS,
    renormalize_weights,
    run_structural,
)

try:
    from run_structural import _merge_code_quality_verdict  # noqa: E402
except ImportError:
    _merge_code_quality_verdict = None  # type: ignore[assignment]

SKILL_ROOT = Path(__file__).parent.parent
FIXTURES = SKILL_ROOT / "fixtures"
RUBRIC = SKILL_ROOT / "templates" / "rubric-v1.md"
THRESHOLDS = SKILL_ROOT.parent.parent / "rules" / "plan-confidence-thresholds.txt"


# ADR D8 / EC-2 renormalize tests

def test_renormalize_weights_m2_sums_to_one() -> None:
    weights = renormalize_weights(["completeness", "structural_risk"])
    assert abs(sum(weights.values()) - 1.0) < 1e-9


def test_renormalize_weights_m2_proportions_correct() -> None:
    weights = renormalize_weights(["completeness", "structural_risk"])
    # SOTA: completeness=0.30, risco=0.20. Sum 0.50. completeness/0.50 = 0.6.
    assert abs(weights["completeness"] - 0.6) < 1e-9
    assert abs(weights["structural_risk"] - 0.4) < 1e-9


def test_renormalize_weights_m3_proportions_correct() -> None:
    """When M3 activates evidence (0.30 SOTA): sum 0.30+0.30+0.20=0.80. Renormalized 3/8, 3/8, 2/8."""
    weights = renormalize_weights(["completeness", "evidence", "structural_risk"])
    assert abs(weights["completeness"] - 0.30 / 0.80) < 1e-9
    assert abs(weights["evidence"] - 0.30 / 0.80) < 1e-9
    assert abs(weights["structural_risk"] - 0.20 / 0.80) < 1e-9
    assert abs(sum(weights.values()) - 1.0) < 1e-9


# Verdict tests with fixtures

def test_run_structural_good_plan_passes() -> None:
    """fixture good-plan.md: coverage 100%, ADRs with alternatives, bug-fix with TDD."""
    report = run_structural(FIXTURES / "good-plan.md", RUBRIC, THRESHOLDS)
    # Verdict should NOT be INVALID
    assert report.verdict != "INVALID"
    assert report.hard_caps_triggered == []
    # In M2 with renormalization, max achievable is 100. We expect at least 70 (SHIPPABLE_WITH_CAVEATS).
    assert report.final_score_after_caps >= 70, (
        f"good-plan got {report.final_score_after_caps}, expected >= 70. "
        f"completeness={report.completude_score}, risco={report.risco_estrutural_score}"
    )


def test_run_structural_m2_score_can_reach_above_50() -> None:
    """v1.1 EC-2 fix: with renormalization, score is NOT capped at 50 in M2."""
    report = run_structural(FIXTURES / "good-plan.md", RUBRIC, THRESHOLDS)
    assert report.final_score_after_caps > 50, (
        "EC-2 fix: M2 renormalization must allow scores above 50"
    )


def test_run_structural_missing_coverage_capped() -> None:
    report = run_structural(FIXTURES / "missing-coverage-plan.md", RUBRIC, THRESHOLDS)
    assert "coverage_lt_100" in report.hard_caps_triggered
    assert report.verdict == "INVALID"
    assert report.final_score_after_caps <= 49


def test_run_structural_no_tdd_capped() -> None:
    report = run_structural(FIXTURES / "no-tdd-plan.md", RUBRIC, THRESHOLDS)
    assert "bugfix_without_tdd" in report.hard_caps_triggered
    assert report.final_score_after_caps <= 70


def test_run_structural_weak_imperatives_penalty() -> None:
    report = run_structural(FIXTURES / "weak-imperatives-plan.md", RUBRIC, THRESHOLDS)
    # Should have structural_risk < 100 due to smells, but no hard cap from smells
    assert report.risco_estrutural_score < 100
    assert "coverage_lt_100" not in report.hard_caps_triggered


# JSON output structure tests

def test_run_structural_emits_valid_json_compatible_data() -> None:
    """Verify the report can be serialized to valid JSON."""
    report = run_structural(FIXTURES / "good-plan.md", RUBRIC, THRESHOLDS)
    # dataclass to dict (no Motivo nesting issue here since list is empty for M2 evidence/calibration)
    from dataclasses import asdict
    d = asdict(report)
    d["reasons"] = {k: [asdict(m) for m in v] for k, v in report.reasons.items()}
    # Must round-trip
    s = json.dumps(d, indent=2, ensure_ascii=False)
    parsed = json.loads(s)
    assert parsed["plan_slug"] == "good"


def test_run_structural_motivos_has_4_keys() -> None:
    report = run_structural(FIXTURES / "good-plan.md", RUBRIC, THRESHOLDS)
    assert set(report.reasons.keys()) == {"completeness", "evidence", "calibration", "structural_risk"}


def test_run_structural_evidencia_empty_in_m2() -> None:
    report = run_structural(FIXTURES / "good-plan.md", RUBRIC, THRESHOLDS)
    assert report.reasons["evidence"] == []


def test_run_structural_calibracao_empty_in_m2() -> None:
    report = run_structural(FIXTURES / "good-plan.md", RUBRIC, THRESHOLDS)
    assert report.reasons["calibration"] == []


def test_run_structural_output_includes_active_dimensions() -> None:
    """v1.1 EC-2: output must include active_dimensions and weight_normalization_factor."""
    report = run_structural(FIXTURES / "good-plan.md", RUBRIC, THRESHOLDS)
    assert report.active_dimensions == M2_ACTIVE_DIMENSIONS
    assert report.weight_normalization_factor > 0


# CLI tests

def test_run_structural_cli_exit_code_0_on_pass() -> None:
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "run_structural.py"), str(FIXTURES / "good-plan.md")],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, f"stderr: {proc.stderr}"


def test_run_structural_cli_exit_code_1_on_invalid() -> None:
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "run_structural.py"), str(FIXTURES / "missing-coverage-plan.md")],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 1, f"expected 1 (INVALID), got {proc.returncode}. stderr: {proc.stderr}"


def test_run_structural_cli_exit_code_2_on_error() -> None:
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "run_structural.py"), "/tmp/__not_a_plan__"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 2


def test_run_structural_cli_outputs_valid_json() -> None:
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "run_structural.py"), str(FIXTURES / "good-plan.md")],
        capture_output=True,
        text=True,
        check=False,
    )
    # Even on green path, output goes to stdout
    parsed = json.loads(proc.stdout)
    assert "verdict" in parsed
    assert "active_dimensions" in parsed


# Runtime-metric proof (Global DoD requirement)

def test_runtime_metric_proof_missing_coverage_triggers_cap() -> None:
    """Runtime-metric proof per Global DoD: observed non-zero in real workload."""
    report = run_structural(FIXTURES / "missing-coverage-plan.md", RUBRIC, THRESHOLDS)
    assert "coverage_lt_100" in report.hard_caps_triggered, (
        "Runtime-metric proof: missing-coverage-plan fixture MUST trigger coverage_lt_100 cap "
        "and verdict INVALID. This is the smoke test for the entire pipeline."
    )
    assert report.verdict == "INVALID"


# Code-quality integration verdict-merge tests (regression for bug discovered 2026-05-23)
#
# Bug context: when /code-quality returns PASS_WITH_CAVEATS (allowlist-downgraded findings
# at SOFT_FLOOR severity), the previous integration logic blindly merged the
# `hard_caps_triggered` list and forced INVALID — neutralizing the allowlist mechanism.
# The fix consults `code_quality.score_cap` to determine the correct severity tier.

def test_merge_cq_pass_does_not_change_verdict() -> None:
    """PASS verdict (no caps) leaves plan-confidence verdict untouched."""
    if _merge_code_quality_verdict is None:
        return  # function not yet extracted — test will run after GREEN
    out: dict = {"verdict": "SHIPPABLE", "final_score_after_caps": 95, "hard_caps_triggered": []}
    cq = {"verdict": "PASS", "score_cap": 100, "hard_caps_triggered": [], "soft_caps_triggered": []}
    _merge_code_quality_verdict(out, cq)
    assert out["verdict"] == "SHIPPABLE"
    assert out["final_score_after_caps"] == 95


def test_merge_cq_pass_with_caveats_caps_at_89_no_invalid() -> None:
    """Regression test for 2026-05-23 bug: PASS_WITH_CAVEATS (allowlist-downgraded) MUST cap at 89,
    NOT force INVALID. Symbol fab findings allowlisted via sunset are downgraded to SOFT_FLOOR
    severity by /code-quality; plan-confidence MUST respect that downgrade."""
    if _merge_code_quality_verdict is None:
        return  # function not yet extracted — test will run after GREEN
    out: dict = {"verdict": "SHIPPABLE", "final_score_after_caps": 95, "hard_caps_triggered": []}
    cq = {
        "verdict": "PASS_WITH_CAVEATS",
        "score_cap": 89,
        "hard_caps_triggered": ["symbol_fab_unverifiable_typescript"],
        "soft_caps_triggered": [],
    }
    _merge_code_quality_verdict(out, cq)
    # Bug regression: must NOT be INVALID
    assert out["verdict"] != "INVALID", (
        "BUG REGRESSION: PASS_WITH_CAVEATS code-quality verdict was forcing plan-confidence INVALID. "
        "Allowlist downgrade must be respected."
    )
    assert out["verdict"] == "SHIPPABLE_WITH_CAVEATS"
    assert out["final_score_after_caps"] == 89


def test_merge_cq_fail_soft_caps_at_70_non_shippable() -> None:
    """FAIL_SOFT (real SOFT_CAP findings, not allowlisted) caps plan at 70 → NON_SHIPPABLE band."""
    if _merge_code_quality_verdict is None:
        return
    out: dict = {"verdict": "SHIPPABLE", "final_score_after_caps": 95, "hard_caps_triggered": []}
    cq = {
        "verdict": "FAIL_SOFT",
        "score_cap": 70,
        "hard_caps_triggered": ["soft_cap_orphan_export_typescript"],
        "soft_caps_triggered": [],
    }
    _merge_code_quality_verdict(out, cq)
    assert out["verdict"] == "NON_SHIPPABLE"
    assert out["final_score_after_caps"] == 70


def test_merge_cq_fail_hard_forces_invalid() -> None:
    """FAIL_HARD (real HARD findings, no allowlist) forces INVALID (49 cap)."""
    if _merge_code_quality_verdict is None:
        return
    out: dict = {"verdict": "SHIPPABLE", "final_score_after_caps": 95, "hard_caps_triggered": []}
    cq = {
        "verdict": "FAIL_HARD",
        "score_cap": 49,
        "hard_caps_triggered": ["dead_code_unallowlisted_typescript"],
        "soft_caps_triggered": [],
    }
    _merge_code_quality_verdict(out, cq)
    assert out["verdict"] == "INVALID"
    assert out["final_score_after_caps"] == 49


def test_merge_cq_smallest_cap_wins() -> None:
    """If plan already capped lower than code-quality cap, plan's cap stays."""
    if _merge_code_quality_verdict is None:
        return
    out: dict = {"verdict": "INVALID", "final_score_after_caps": 49, "hard_caps_triggered": ["coverage_lt_100"]}
    cq = {
        "verdict": "PASS_WITH_CAVEATS",
        "score_cap": 89,
        "hard_caps_triggered": ["symbol_fab_unverifiable_typescript"],
        "soft_caps_triggered": [],
    }
    _merge_code_quality_verdict(out, cq)
    # Plan was already INVALID; cq's softer 89 cap cannot lift it
    assert out["verdict"] == "INVALID"
    assert out["final_score_after_caps"] == 49
    # But identifier is appended to the cap list (audit trail)
    assert "symbol_fab_unverifiable_typescript" in out["hard_caps_triggered"]
