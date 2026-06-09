"""Tests for check_criterion_executability."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from check_criterion_executability import (  # noqa: E402
    CriterionScore,
    _has_measurable_object,
    _has_observable_verb,
    _has_oracle,
    check_criterion_executability,
)


# ---------- axis-level unit tests ----------------------------------------


@pytest.mark.parametrize("text", [
    "Improve performance of the query path",
    "Optimize the connection pool",
    "Refactor the auth module to be cleaner",
    "Make the API more robust",
    "Clean up the codebase",
    "Ensure quality of generated responses",
    "Handle errors gracefully where applicable",
])
def test_vague_verb_fails_observable_axis(text: str) -> None:
    assert _has_observable_verb(text) is False


@pytest.mark.parametrize("text", [
    "Return 200 OK when token is valid",
    "Persist user record to Postgres on signup",
    "Reject requests larger than 1 MB with 413",
])
def test_concrete_verb_passes_observable_axis(text: str) -> None:
    assert _has_observable_verb(text) is True


@pytest.mark.parametrize("text", [
    "P95 latency < 200ms under 100 req/s",
    "Returns true when balance >= amount",
    "exit code 0 on success",
    "Equals expected JSON shape",
    "`curl /healthz` returns 200",
    "Coverage >= 90% on changed files",
])
def test_measurable_object_detected(text: str) -> None:
    assert _has_measurable_object(text) is True


@pytest.mark.parametrize("text", [
    "Should work well",
    "Behaves correctly under load",
    "Looks good in the UI",
])
def test_no_measurable_object(text: str) -> None:
    assert _has_measurable_object(text) is False


@pytest.mark.parametrize("text", [
    "`pytest tests/test_auth.py::test_token_expiry` exits 0",
    "Given a valid token when the user calls /profile then 200",
    "assertEquals(actual.status, 200)",
    "Metric `gateway_requests_total` emits at least once per integration test",
    "Log line contains 'payment.retried' for every 5xx provider response",
    "Returns the cached value on second call",
])
def test_oracle_detected(text: str) -> None:
    assert _has_oracle(text) is True


@pytest.mark.parametrize("text", [
    "Code should be cleaner",
    "Better error messages",
    "More performant",
])
def test_no_oracle(text: str) -> None:
    assert _has_oracle(text) is False


# ---------- end-to-end on synthetic plans -------------------------------


def _write_plan(tmp_path: Path, body: str) -> Path:
    plan = tmp_path / "test-plan.md"
    plan.write_text(body, encoding="utf-8")
    return plan


def test_plan_with_no_criteria_sections_is_vacuously_acceptable(tmp_path: Path) -> None:
    plan = _write_plan(tmp_path, "# Plan\n\nNo acceptance section at all.\n")
    report = check_criterion_executability(plan)
    assert report.total_criteria == 0
    assert report.acceptable_ratio == 1.0
    assert report.soft_cap_triggered is False


def test_plan_with_all_executable_criteria_passes(tmp_path: Path) -> None:
    body = (
        "## Plan\n\n"
        "### Acceptance Criteria\n\n"
        "- POST /v1/completion returns 200 with body matching schema `completion-v1.json` "
        "via `pytest tests/integration/test_completion.py::test_happy_path`\n"
        "- P95 latency < 200ms under 100 req/s as measured by `wrk -t4 -c100 -d30s`\n"
        "- Metric `gateway_requests_total` emits at least 1 per integration test run, "
        "verified by `.wiring-evidence.json` showing count > 0\n"
    )
    plan = _write_plan(tmp_path, body)
    report = check_criterion_executability(plan)
    assert report.total_criteria == 3
    assert report.executable_ratio == 1.0
    assert report.soft_cap_triggered is False


def test_plan_with_all_vague_criteria_triggers_soft_cap(tmp_path: Path) -> None:
    body = (
        "## Plan\n\n"
        "### Acceptance Criteria\n\n"
        "- Improve performance\n"
        "- Refactor the module to be cleaner\n"
        "- Handle errors gracefully\n"
        "- Make the API better\n"
    )
    plan = _write_plan(tmp_path, body)
    report = check_criterion_executability(plan)
    assert report.total_criteria == 4
    assert report.vague_ratio == 1.0
    assert report.acceptable_ratio == 0.0
    assert report.soft_cap_triggered is True


def test_plan_with_mixed_criteria_triggers_on_vague_ratio(tmp_path: Path) -> None:
    """4 criteria: 2 vague (50% > 10% threshold) → soft_cap fires."""
    body = (
        "## Plan\n\n"
        "### Acceptance Criteria\n\n"
        "- POST /signup returns 201 on success\n"
        "- `pytest tests/test_signup.py` exits 0\n"
        "- Improve overall code quality\n"
        "- Make signup faster\n"
    )
    plan = _write_plan(tmp_path, body)
    report = check_criterion_executability(plan)
    assert report.total_criteria == 4
    assert report.vague_count == 2
    assert report.vague_ratio == 0.5
    assert report.soft_cap_triggered is True


def test_plan_with_just_below_threshold_does_not_trigger(tmp_path: Path) -> None:
    """10 criteria, 1 vague (10% == 10%, not > 10%) and others acceptable → no soft cap."""
    body = (
        "## Plan\n\n"
        "### Acceptance Criteria\n\n"
        + "\n".join([
            f"- Returns {i+200} when input matches case {i} per `pytest tests/test_x.py::case_{i}`"
            for i in range(9)
        ])
        + "\n- Make it better\n"
    )
    plan = _write_plan(tmp_path, body)
    report = check_criterion_executability(plan)
    assert report.total_criteria == 10
    assert report.vague_count == 1
    assert abs(report.vague_ratio - 0.1) < 1e-9
    # vague_ratio NOT > 0.10 → first condition does not fire.
    # acceptable_ratio = 9/10 = 0.9 ≥ 0.80 → second condition does not fire.
    assert report.soft_cap_triggered is False


def test_dod_section_also_scanned(tmp_path: Path) -> None:
    """Definition of Done bullets count as criteria too."""
    body = (
        "## Plan\n\n"
        "### Definition of Done\n\n"
        "- Improve testing\n"
        "- Improve docs\n"
    )
    plan = _write_plan(tmp_path, body)
    report = check_criterion_executability(plan)
    assert report.total_criteria == 2
    assert report.vague_count == 2


def test_score_aggregation_per_criterion(tmp_path: Path) -> None:
    """Verify score breakdown is exposed per-criterion for human override."""
    body = (
        "## Plan\n\n"
        "### Acceptance Criteria\n\n"
        "- Returns 200 OK and Coverage >= 90% via `pytest`\n"  # 3/3
        "- Returns 200 OK\n"                                    # 2/3 (no oracle)
        "- POST a record\n"                                     # 1/3 (verb only)
        "- Improve performance\n"                               # 0/3
    )
    plan = _write_plan(tmp_path, body)
    report = check_criterion_executability(plan)
    assert report.total_criteria == 4
    scores = sorted(c.score for c in report.criteria)
    assert scores == [0, 1, 2, 3]
