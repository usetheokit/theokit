"""Tests for mini_review orchestrator."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from mini_review import _compute_verdict, run_mini_review


# ---------- verdict aggregation ----------------------------------------


def test_verdict_pass_when_only_info() -> None:
    findings = [{"severity": "INFO", "code": "x", "message": "x"}]
    verdict, max_sev = _compute_verdict(findings)
    assert verdict == "PHASE_REVIEW_PASS"
    assert max_sev == "INFO"


def test_verdict_pass_when_medium_and_low() -> None:
    findings = [
        {"severity": "MEDIUM", "code": "x", "message": "x"},
        {"severity": "LOW", "code": "y", "message": "y"},
    ]
    verdict, max_sev = _compute_verdict(findings)
    assert verdict == "PHASE_REVIEW_PASS"
    assert max_sev == "MEDIUM"


def test_verdict_needs_fix_when_high() -> None:
    findings = [{"severity": "HIGH", "code": "x", "message": "x"}]
    verdict, max_sev = _compute_verdict(findings)
    assert verdict == "PHASE_REVIEW_NEEDS_FIX"
    assert max_sev == "HIGH"


def test_verdict_needs_fix_when_blocker() -> None:
    findings = [
        {"severity": "MEDIUM", "code": "x", "message": "x"},
        {"severity": "BLOCKER", "code": "y", "message": "y"},
    ]
    verdict, max_sev = _compute_verdict(findings)
    assert verdict == "PHASE_REVIEW_NEEDS_FIX"
    assert max_sev == "BLOCKER"


# ---------- end-to-end orchestration -----------------------------------


def _write_progress(tmp_path: Path, tasks: list[dict]) -> Path:
    p = tmp_path / ".progress-foo.json"
    p.write_text(json.dumps({"slug": "foo", "tasks": tasks}), encoding="utf-8")
    return p


def _write_plan(tmp_path: Path, body: str) -> Path:
    p = tmp_path / "foo-plan.md"
    p.write_text(body, encoding="utf-8")
    return p


def test_e2e_clean_phase_passes(tmp_path: Path) -> None:
    plan_body = (
        "## Phase 1\n"
        "### T1.1 — Foo\n#### Files to edit\n- src/foo.py\n#### TDD\nRED\n"
        "### T1.2 — Bar\n#### Files to edit\n- src/bar.py\n#### TDD\nRED\n"
    )
    progress = _write_progress(tmp_path, [
        {"id": "T1.1", "phase": "1", "status": "committed", "files": ["src/foo.py"]},
        {"id": "T1.2", "phase": "1", "status": "committed", "files": ["src/bar.py"]},
    ])
    plan = _write_plan(tmp_path, plan_body)
    output_dir = tmp_path / "mini-reviews"

    verdict, max_sev, report_path = run_mini_review(
        slug="foo",
        plan_path=plan,
        progress_path=progress,
        phase="1",
        project_root=tmp_path,  # no real source tree → wiring will be N/A
        output_dir=output_dir,
    )

    assert verdict == "PHASE_REVIEW_PASS"
    assert report_path.exists()
    content = report_path.read_text(encoding="utf-8")
    assert "PHASE_REVIEW_PASS" in content
    assert "Phase 1" in content


def test_e2e_scope_drift_triggers_needs_fix(tmp_path: Path) -> None:
    plan_body = (
        "## Phase 1\n"
        "### T1.1 — Foo\n#### Files to edit\n- src/foo.py\n#### TDD\nRED\n"
    )
    progress = _write_progress(tmp_path, [
        {"id": "T1.1", "phase": "1", "status": "committed",
         "files": ["src/foo.py", "src/UNAUTHORIZED.py"]},
    ])
    plan = _write_plan(tmp_path, plan_body)
    output_dir = tmp_path / "mini-reviews"

    verdict, max_sev, report_path = run_mini_review(
        slug="foo", plan_path=plan, progress_path=progress, phase="1",
        project_root=tmp_path, output_dir=output_dir,
    )

    assert verdict == "PHASE_REVIEW_NEEDS_FIX"
    content = report_path.read_text(encoding="utf-8")
    assert "scope_drift" in content
    assert "UNAUTHORIZED.py" in content
    assert "MUST emit BLOCKED" in content


def test_e2e_blocked_task_in_phase_triggers_needs_fix(tmp_path: Path) -> None:
    plan_body = (
        "## Phase 1\n"
        "### T1.1 — Foo\n#### Files to edit\n- src/foo.py\n"
        "### T1.2 — Bar\n#### Files to edit\n- src/bar.py\n"
    )
    progress = _write_progress(tmp_path, [
        {"id": "T1.1", "phase": "1", "status": "committed", "files": ["src/foo.py"]},
        {"id": "T1.2", "phase": "1", "status": "blocked", "files": []},
    ])
    plan = _write_plan(tmp_path, plan_body)
    output_dir = tmp_path / "mini-reviews"

    verdict, _, report_path = run_mini_review(
        slug="foo", plan_path=plan, progress_path=progress, phase="1",
        project_root=tmp_path, output_dir=output_dir,
    )

    assert verdict == "PHASE_REVIEW_NEEDS_FIX"
    assert "phase_has_blocked_tasks" in report_path.read_text(encoding="utf-8")


def test_report_filename_format(tmp_path: Path) -> None:
    plan_body = "## Phase 1\n### T1.1 — Foo\n#### Files to edit\n- src/foo.py\n"
    progress = _write_progress(tmp_path, [
        {"id": "T1.1", "phase": "1", "status": "committed", "files": ["src/foo.py"]},
    ])
    plan = _write_plan(tmp_path, plan_body)
    output_dir = tmp_path / "mini-reviews"

    _, _, report_path = run_mini_review(
        slug="alpha", plan_path=plan, progress_path=progress, phase="1",
        project_root=tmp_path, output_dir=output_dir,
    )

    # Format: {slug}-phase{N}-review-{YYYY-MM-DD}.md
    assert report_path.name.startswith("alpha-phase1-review-")
    assert report_path.name.endswith(".md")
    assert report_path.parent == output_dir
