"""Tests for check_progress_schema — fail-fast validation of the checkpoint."""
from __future__ import annotations

import json
from pathlib import Path

from check_progress_schema import check_progress_schema, validate_progress


def _write(tmp_path: Path, data) -> Path:
    p = tmp_path / ".progress-foo.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    return p


def test_valid_checkpoint_passes(tmp_path: Path) -> None:
    p = _write(tmp_path, {
        "slug": "foo",
        "tasks": [
            {"id": "T1.1", "phase": "1", "status": "committed",
             "files": ["src/foo.py"], "commit_sha": "abc123",
             "wiring": {"a": "pass", "b": "pass", "c": "n/a"}},
        ],
    })
    report = check_progress_schema(p)
    assert report.status == "PASS"
    assert report.task_count == 1


def test_missing_file_is_skip(tmp_path: Path) -> None:
    report = check_progress_schema(tmp_path / "nope.json")
    assert report.status == "SKIP"
    assert report.exists is False


def test_malformed_json_is_blocker(tmp_path: Path) -> None:
    p = tmp_path / ".progress-foo.json"
    p.write_text("{ not json", encoding="utf-8")
    report = check_progress_schema(p)
    assert report.status == "FAIL"
    assert "progress_malformed_json" in [f.code for f in report.findings]


def test_bare_object_without_tasks_envelope_fails(tmp_path: Path) -> None:
    """GAP found in review: the prompt example wrote a bare task object; gates read
    data['tasks']. A bare object has no consumable tasks."""
    p = _write(tmp_path, {"task_id": "T1.1", "status": "committed"})
    report = check_progress_schema(p)
    assert report.status == "FAIL"
    assert "progress_missing_tasks" in [f.code for f in report.findings]


def test_task_id_key_instead_of_id_is_flagged(tmp_path: Path) -> None:
    p = _write(tmp_path, {"tasks": [{"task_id": "T1.1", "phase": "1", "status": "committed"}]})
    findings = validate_progress(json.loads(p.read_text()))
    codes = [f.code for f in findings]
    assert "task_uses_task_id_key" in codes


def test_task_missing_phase_is_flagged(tmp_path: Path) -> None:
    p = _write(tmp_path, {"tasks": [{"id": "T1.1", "status": "committed"}]})
    findings = validate_progress(json.loads(p.read_text()))
    assert "task_missing_phase" in [f.code for f in findings]


def test_invalid_status_is_flagged(tmp_path: Path) -> None:
    findings = validate_progress({"tasks": [{"id": "T1.1", "phase": "1", "status": "donezo"}]})
    assert "task_invalid_status" in [f.code for f in findings]


def test_committed_without_sha_is_flagged(tmp_path: Path) -> None:
    findings = validate_progress({"tasks": [{"id": "T1.1", "phase": "1", "status": "committed"}]})
    assert "committed_without_sha" in [f.code for f in findings]


def test_blocked_without_reason_is_flagged(tmp_path: Path) -> None:
    findings = validate_progress({"tasks": [{"id": "T1.1", "phase": "1", "status": "blocked"}]})
    assert "blocked_without_reason" in [f.code for f in findings]


def test_tasks_not_a_list_fails(tmp_path: Path) -> None:
    findings = validate_progress({"tasks": {"id": "T1.1"}})
    assert "tasks_not_array" in [f.code for f in findings]
