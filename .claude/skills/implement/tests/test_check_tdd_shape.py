"""Tests for check_tdd_shape.py — /implement Step 2 defense-in-depth gate."""
from __future__ import annotations

from pathlib import Path

import pytest

from check_tdd_shape import (
    _has_assertion_shape,
    _has_gwt_shape,
    _has_test_fn_shape,
    check_tdd_shape,
)


# ---------- axis-level unit tests ----------------------------------------


@pytest.mark.parametrize("text", [
    "assertEquals(result.status, 200)",
    "assert response.body == expected",
    "expect(value).toBe(42)",
    "expect(result).toEqual({ok: true})",
    "result should equal 'OK'",
    "self.assertRaises(ValueError)",
])
def test_assertion_shape_detected(text: str) -> None:
    assert _has_assertion_shape(text) is True


@pytest.mark.parametrize("text", [
    "Make the code pass",
    "Tests should be green",
    "Write a test",
])
def test_no_assertion_shape(text: str) -> None:
    assert _has_assertion_shape(text) is False


@pytest.mark.parametrize("text", [
    "Given a valid token, when the user calls /profile, then 200 is returned",
    "GIVEN an empty cart WHEN the user clicks checkout THEN error 400 is shown",
])
def test_gwt_shape_detected(text: str) -> None:
    assert _has_gwt_shape(text) is True


def test_no_gwt_shape() -> None:
    # Missing "Then"
    assert _has_gwt_shape("Given a token when the user calls /profile") is False


@pytest.mark.parametrize("text", [
    "test_payment_retry_on_502(provider_response='502') -> retried_once",
    "RED: test_user_signup_returns_201",
    "test_token_expiry(now=expired_at) returns 401",
])
def test_test_fn_shape_detected(text: str) -> None:
    assert _has_test_fn_shape(text) is True


# ---------- end-to-end on synthetic plans -------------------------------


def _write_plan(tmp_path: Path, body: str) -> Path:
    plan = tmp_path / "plan.md"
    plan.write_text(body, encoding="utf-8")
    return plan


def test_task_without_tdd_section_is_blocked(tmp_path: Path) -> None:
    body = (
        "## Phase 1\n\n"
        "### T1.1 — Build endpoint\n\n"
        "#### Objective\nBuild it.\n\n"
        "#### Acceptance Criteria\n- works\n"
    )
    plan = _write_plan(tmp_path, body)
    report = check_tdd_shape(plan)
    assert report.total_tasks == 1
    assert report.all_pass is False
    assert report.blocked_tasks[0].task_id == "T1.1"
    assert report.blocked_tasks[0].has_tdd_block is False


def test_task_with_tdd_block_but_no_shape_is_blocked(tmp_path: Path) -> None:
    body = (
        "### T1.1 — Foo\n\n"
        "#### TDD\nWrite some tests. They should be good.\n\n"
        "#### Done\n"
    )
    plan = _write_plan(tmp_path, body)
    report = check_tdd_shape(plan)
    assert report.all_pass is False
    blocked = report.blocked_tasks[0]
    assert blocked.has_tdd_block is True
    assert blocked.has_executable_shape is False


def test_task_with_assertion_shape_passes(tmp_path: Path) -> None:
    body = (
        "### T1.1 — Build endpoint\n\n"
        "#### TDD\nRED:\n```python\ndef test_endpoint_returns_200():\n    "
        "assert response.status_code == 200\n```\n"
    )
    plan = _write_plan(tmp_path, body)
    report = check_tdd_shape(plan)
    assert report.all_pass is True


def test_task_with_gwt_shape_passes(tmp_path: Path) -> None:
    body = (
        "### T1.1 — Checkout flow\n\n"
        "#### TDD\nGiven an empty cart when the user clicks checkout then error 400 "
        "is shown with message 'cart empty'.\n"
    )
    plan = _write_plan(tmp_path, body)
    report = check_tdd_shape(plan)
    assert report.all_pass is True


def test_task_with_test_fn_shape_passes(tmp_path: Path) -> None:
    body = (
        "### T1.1 — Token expiry\n\n"
        "#### TDD\nRED: test_token_expired_returns_401\nGREEN: validate exp claim\n"
    )
    plan = _write_plan(tmp_path, body)
    report = check_tdd_shape(plan)
    assert report.all_pass is True


def test_multiple_tasks_one_blocked(tmp_path: Path) -> None:
    body = (
        "### T1.1 — Good task\n\n"
        "#### TDD\nRED: test_happy_path\nGREEN: impl\n\n"
        "### T1.2 — Bad task\n\n"
        "#### TDD\nWill be tested somehow.\n"
    )
    plan = _write_plan(tmp_path, body)
    report = check_tdd_shape(plan)
    assert report.total_tasks == 2
    assert report.tasks_with_shape == 1
    assert report.all_pass is False
    assert [b.task_id for b in report.blocked_tasks] == ["T1.2"]


def test_plan_without_tasks_returns_empty_report(tmp_path: Path) -> None:
    body = "# Plan\n\n## Context\nNo tasks here.\n"
    plan = _write_plan(tmp_path, body)
    report = check_tdd_shape(plan)
    assert report.total_tasks == 0
    assert report.all_pass is True


def test_cli_exit_code_0_when_all_pass(tmp_path: Path) -> None:
    import subprocess
    plan_body = "### T1.1 — Foo\n\n#### TDD\nRED: test_foo_returns_true\n"
    plan = _write_plan(tmp_path, plan_body)
    script = Path(__file__).parent.parent / "scripts" / "check_tdd_shape.py"
    result = subprocess.run(
        ["python3", str(script), "--plan", str(plan), "--json"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0
    assert '"all_pass": true' in result.stdout


def test_cli_exit_code_1_when_blocked(tmp_path: Path) -> None:
    import subprocess
    plan_body = "### T1.1 — Foo\n\n#### Objective\nDo it.\n"
    plan = _write_plan(tmp_path, plan_body)
    script = Path(__file__).parent.parent / "scripts" / "check_tdd_shape.py"
    result = subprocess.run(
        ["python3", str(script), "--plan", str(plan), "--json"],
        capture_output=True, text=True,
    )
    assert result.returncode == 1
    assert "blocked_task_ids" in result.stdout
    assert "T1.1" in result.stdout
