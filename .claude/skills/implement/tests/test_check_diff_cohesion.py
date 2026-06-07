"""Tests for check_diff_cohesion."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from check_diff_cohesion import check_diff_cohesion


def _write_progress(tmp_path: Path, tasks: list[dict]) -> Path:
    p = tmp_path / ".progress-foo.json"
    p.write_text(json.dumps({"slug": "foo", "tasks": tasks}), encoding="utf-8")
    return p


def _write_plan(tmp_path: Path, body: str) -> Path:
    p = tmp_path / "foo-plan.md"
    p.write_text(body, encoding="utf-8")
    return p


def test_no_drift_when_modified_matches_declared(tmp_path: Path) -> None:
    plan_body = (
        "## Phase 1\n"
        "### T1.1 — Foo\n"
        "#### Files to edit\n- src/foo.py\n- src/foo_test.py\n"
        "#### TDD\nRED: test_foo\n"
    )
    progress = _write_progress(tmp_path, [
        {"id": "T1.1", "phase": "1", "status": "committed",
         "files": ["src/foo.py", "src/foo_test.py"]},
    ])
    plan = _write_plan(tmp_path, plan_body)
    report = check_diff_cohesion(plan, progress, "1")
    assert report.drift_files == ()
    assert report.has_high_or_blocker is False
    assert report.diff_source == "progress"


def test_drift_detected_when_extra_file_modified(tmp_path: Path) -> None:
    plan_body = (
        "## Phase 1\n"
        "### T1.1 — Foo\n"
        "#### Files to edit\n- src/foo.py\n"
    )
    progress = _write_progress(tmp_path, [
        {"id": "T1.1", "phase": "1", "status": "committed",
         "files": ["src/foo.py", "src/unauthorized.py"]},
    ])
    plan = _write_plan(tmp_path, plan_body)
    report = check_diff_cohesion(plan, progress, "1")
    assert "src/unauthorized.py" in report.drift_files
    assert report.has_high_or_blocker is True
    codes = [f.code for f in report.findings if f.severity == "HIGH"]
    assert "scope_drift" in codes


def test_non_source_files_not_flagged_as_drift(tmp_path: Path) -> None:
    """CHANGELOG.md, package.json etc are allowed even if not declared."""
    plan_body = (
        "## Phase 1\n"
        "### T1.1 — Foo\n"
        "#### Files to edit\n- src/foo.py\n"
    )
    progress = _write_progress(tmp_path, [
        {"id": "T1.1", "phase": "1", "status": "committed",
         "files": ["src/foo.py", "CHANGELOG.md", "package.json"]},
    ])
    plan = _write_plan(tmp_path, plan_body)
    report = check_diff_cohesion(plan, progress, "1")
    assert report.drift_files == ()
    assert report.has_high_or_blocker is False


def test_no_declared_scope_triggers_medium(tmp_path: Path) -> None:
    plan_body = "## Phase 1\n### T1.1 — Foo\n#### TDD\nRED\n"  # no Files to edit
    progress = _write_progress(tmp_path, [
        {"id": "T1.1", "phase": "1", "status": "committed", "files": ["src/foo.py"]},
    ])
    plan = _write_plan(tmp_path, plan_body)
    report = check_diff_cohesion(plan, progress, "1")
    medium_codes = [f.code for f in report.findings if f.severity == "MEDIUM"]
    assert "no_declared_scope" in medium_codes
    # MEDIUM should not block
    assert report.has_high_or_blocker is False


def test_no_diff_source_when_progress_empty(tmp_path: Path) -> None:
    plan_body = "## Phase 1\n### T1.1 — Foo\n#### Files to edit\n- src/foo.py\n"
    # Task without 'files' field at all
    progress = _write_progress(tmp_path, [
        {"id": "T1.1", "phase": "1", "status": "committed"},
    ])
    plan = _write_plan(tmp_path, plan_body)
    report = check_diff_cohesion(plan, progress, "1")
    medium_codes = [f.code for f in report.findings if f.severity == "MEDIUM"]
    assert "no_diff_source" in medium_codes
    assert report.diff_source == "none"


def test_cross_layer_check_skipped_always(tmp_path: Path) -> None:
    """Cross-layer detector is a future feature — must always record INFO skip."""
    plan_body = "## Phase 1\n### T1.1 — Foo\n#### Files to edit\n- src/foo.py\n"
    progress = _write_progress(tmp_path, [
        {"id": "T1.1", "phase": "1", "status": "committed", "files": ["src/foo.py"]},
    ])
    plan = _write_plan(tmp_path, plan_body)
    report = check_diff_cohesion(plan, progress, "1")
    info_codes = [f.code for f in report.findings if f.severity == "INFO"]
    assert "cross_layer_check_skipped" in info_codes
    assert report.cross_layer_checked is False
