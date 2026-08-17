"""Tests for check_phase_completeness."""
from __future__ import annotations

import json
from pathlib import Path


from check_phase_completeness import check_phase_completeness


def _write_progress(tmp_path: Path, tasks: list[dict]) -> Path:
    p = tmp_path / ".progress-foo.json"
    p.write_text(json.dumps({"slug": "foo", "tasks": tasks}), encoding="utf-8")
    return p


def _write_plan(tmp_path: Path, body: str) -> Path:
    p = tmp_path / "foo-plan.md"
    p.write_text(body, encoding="utf-8")
    return p


def test_phase_all_committed_pass(tmp_path: Path) -> None:
    progress = _write_progress(tmp_path, [
        {"id": "T1.1", "phase": "1", "status": "committed"},
        {"id": "T1.2", "phase": "1", "status": "committed"},
        {"id": "T2.1", "phase": "2", "status": "pending"},
    ])
    plan = _write_plan(tmp_path, "## Phase 1\n### T1.1\n### T1.2\n## Phase 2\n### T2.1\n")
    report = check_phase_completeness(plan, progress, "1")
    assert report.total_tasks_in_phase == 2
    assert report.committed_count == 2
    assert report.blocked_count == 0
    assert report.has_high_or_blocker is False


def test_phase_with_blocked_task_high(tmp_path: Path) -> None:
    progress = _write_progress(tmp_path, [
        {"id": "T1.1", "phase": "1", "status": "committed"},
        {"id": "T1.2", "phase": "1", "status": "blocked"},
    ])
    plan = _write_plan(tmp_path, "## Phase 1\n### T1.1\n### T1.2\n")
    report = check_phase_completeness(plan, progress, "1")
    assert report.blocked_count == 1
    assert report.has_high_or_blocker is True
    high_codes = [f.code for f in report.findings if f.severity == "HIGH"]
    assert "phase_has_blocked_tasks" in high_codes


def test_phase_with_pending_task_high(tmp_path: Path) -> None:
    progress = _write_progress(tmp_path, [
        {"id": "T1.1", "phase": "1", "status": "committed"},
        {"id": "T1.2", "phase": "1", "status": "pending"},
    ])
    plan = _write_plan(tmp_path, "## Phase 1\n### T1.1\n### T1.2\n")
    report = check_phase_completeness(plan, progress, "1")
    assert report.has_high_or_blocker is True
    high_codes = [f.code for f in report.findings if f.severity == "HIGH"]
    assert "phase_has_pending_tasks" in high_codes


def test_missing_phase_in_progress(tmp_path: Path) -> None:
    progress = _write_progress(tmp_path, [{"id": "T1.1", "phase": "1", "status": "committed"}])
    plan = _write_plan(tmp_path, "## Phase 1\n### T1.1\n## Phase 99\n")
    report = check_phase_completeness(plan, progress, "99")
    assert report.has_high_or_blocker is True
    codes = [f.code for f in report.findings]
    assert "phase_not_found_in_progress" in codes


def test_phase_dod_declared_and_populated(tmp_path: Path) -> None:
    progress = _write_progress(tmp_path, [{"id": "T1.1", "phase": "1", "status": "committed"}])
    plan_body = (
        "## Phase 1\n"
        "### T1.1\nBuild it.\n"
        "### Phase 1 — Definition of Done\n"
        "- All tasks committed\n"
        "- Integration test green\n"
    )
    plan = _write_plan(tmp_path, plan_body)
    report = check_phase_completeness(plan, progress, "1")
    assert report.phase_dod_present is True
    assert report.phase_dod_lines >= 2
    assert report.has_high_or_blocker is False
    # No MEDIUM "empty" finding
    assert not any(f.code == "phase_dod_empty" for f in report.findings)


def test_phase_dod_declared_but_empty(tmp_path: Path) -> None:
    progress = _write_progress(tmp_path, [{"id": "T1.1", "phase": "1", "status": "committed"}])
    plan_body = (
        "## Phase 1\n"
        "### T1.1\nBuild it.\n"
        "### Phase 1 — Definition of Done\n\n"
        "## Phase 2\n### T2.1\n"
    )
    plan = _write_plan(tmp_path, plan_body)
    report = check_phase_completeness(plan, progress, "1")
    assert report.phase_dod_present is True
    assert report.phase_dod_lines == 0
    medium_codes = [f.code for f in report.findings if f.severity == "MEDIUM"]
    assert "phase_dod_empty" in medium_codes
    # MEDIUM does not trigger HIGH/BLOCKER gate
    assert report.has_high_or_blocker is False


def test_phase_dod_absent_only_info(tmp_path: Path) -> None:
    progress = _write_progress(tmp_path, [{"id": "T1.1", "phase": "1", "status": "committed"}])
    plan = _write_plan(tmp_path, "## Phase 1\n### T1.1\nBuild it.\n")
    report = check_phase_completeness(plan, progress, "1")
    assert report.phase_dod_present is False
    info_codes = [f.code for f in report.findings if f.severity == "INFO"]
    assert "phase_dod_absent" in info_codes
    assert report.has_high_or_blocker is False
