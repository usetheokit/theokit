"""L3 — JSON Schema validation for all real and fuzzed runs."""
from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import asdict
from pathlib import Path

import jsonschema
import pytest

SCRIPTS_DIR = Path(__file__).parent.parent / "scripts"

from run_structural import run_structural  # noqa: E402

SKILL_ROOT = Path(__file__).parent.parent
SCHEMA_PATH = SKILL_ROOT / "templates" / "score-report.schema.json"
RUBRIC = SKILL_ROOT / "templates" / "rubric-v1.md"
THRESHOLDS = SKILL_ROOT.parent.parent / "rules" / "plan-confidence-thresholds.txt"
PLANS_DIR = SKILL_ROOT.parent.parent / "knowledge-base" / "plans"
COMPLETED_DIR = PLANS_DIR / "completed"
FIXTURES = SKILL_ROOT / "fixtures"


@pytest.fixture(scope="module")
def schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def _report_to_dict(plan_path: Path) -> dict:
    report = run_structural(plan_path, RUBRIC, THRESHOLDS)
    d = asdict(report)
    d["reasons"] = {k: [asdict(m) for m in v] for k, v in report.reasons.items()}
    return d


def test_schema_file_exists() -> None:
    assert SCHEMA_PATH.exists()


def test_schema_is_valid_jsonschema_draft_2020_12(schema: dict) -> None:
    jsonschema.Draft202012Validator.check_schema(schema)


@pytest.mark.parametrize("fixture_name", [
    "good-plan.md",
    "missing-coverage-plan.md",
    "weak-imperatives-plan.md",
    "no-tdd-plan.md",
])
def test_fixture_output_validates_against_schema(fixture_name: str, schema: dict) -> None:
    out = _report_to_dict(FIXTURES / fixture_name)
    jsonschema.validate(out, schema)


@pytest.mark.parametrize("plan_filename", [
    "observability-cache-maturity-plan.md",
    "theo-cli-cohesion-remediation-plan.md",
    "sota-gaps-remediation-plan.md",
])
def test_real_plan_output_validates_against_schema(plan_filename: str, schema: dict) -> None:
    plan_path = None
    for cand in (PLANS_DIR / plan_filename, COMPLETED_DIR / plan_filename):
        if cand.exists():
            plan_path = cand
            break
    if plan_path is None:
        pytest.skip(f"plan not found: {plan_filename}")
    out = _report_to_dict(plan_path)
    jsonschema.validate(out, schema)


def test_cli_output_validates_against_schema(schema: dict) -> None:
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPTS_DIR / "run_structural.py"),
            str(FIXTURES / "good-plan.md"),
            "--no-warn",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    parsed = json.loads(proc.stdout)
    jsonschema.validate(parsed, schema)


def test_schema_rejects_invalid_verdict() -> None:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    bad = {
        "plan_slug": "x", "plan_path": "x", "plan_version": "1",
        "scored_at": "2026-05-17T00:00:00+00:00",
        "completude_score": 50, "risco_estrutural_score": 50,
        "active_dimensions": ["completeness"],
        "weight_normalization_factor": 1.0,
        "weighted_avg": 50, "hard_caps_triggered": [],
        "final_score_after_caps": 50,
        "verdict": "MAYBE_OK",  # invalid
        "reasons": {"completeness": [], "evidence": [], "calibration": [], "structural_risk": []},
        "sub_reports": {
            "coverage_matrix": {"total_gaps": 0, "mapped_gaps": 0, "coverage_ratio": 1.0, "is_complete": True},
            "adr_completeness": {"total_adrs": 0, "with_alternatives": 0, "completeness_ratio": 1.0},
            "tdd_in_bugfix": {"total_bugfix_tasks": 0, "with_tdd": 0, "coverage_ratio": 1.0},
            "spec_smells": {"total_hits": 0, "by_category": {}, "total_penalty": 0},
        },
    }
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad, schema)


def test_schema_rejects_out_of_range_score() -> None:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    bad = {
        "plan_slug": "x", "plan_path": "x", "plan_version": "1",
        "scored_at": "2026-05-17T00:00:00+00:00",
        "completude_score": 150,  # out of range
        "risco_estrutural_score": 50,
        "active_dimensions": ["completeness"],
        "weight_normalization_factor": 1.0,
        "weighted_avg": 100, "hard_caps_triggered": [],
        "final_score_after_caps": 100,
        "verdict": "SHIPPABLE",
        "reasons": {"completeness": [], "evidence": [], "calibration": [], "structural_risk": []},
        "sub_reports": {
            "coverage_matrix": {"total_gaps": 0, "mapped_gaps": 0, "coverage_ratio": 1.0, "is_complete": True},
            "adr_completeness": {"total_adrs": 0, "with_alternatives": 0, "completeness_ratio": 1.0},
            "tdd_in_bugfix": {"total_bugfix_tasks": 0, "with_tdd": 0, "coverage_ratio": 1.0},
            "spec_smells": {"total_hits": 0, "by_category": {}, "total_penalty": 0},
        },
    }
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad, schema)
