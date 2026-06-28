"""Tests for check_checkpoint_consistency — cross-checks the checkpoint vs git."""
from __future__ import annotations

import subprocess
from pathlib import Path

from check_checkpoint_consistency import (
    check_checkpoint_consistency,
    plan_task_ids_from_text,
)


def _git(repo: Path, *a: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *a],
                          capture_output=True, text=True, check=True).stdout


def _repo(tmp_path: Path) -> Path:
    repo = tmp_path / "r"
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@t.t")
    _git(repo, "config", "user.name", "t")
    return repo


def _commit(repo: Path, rel: str, content: str, msg: str) -> str:
    p = repo / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    _git(repo, "add", rel)
    _git(repo, "commit", "-q", "-m", msg)
    return _git(repo, "rev-parse", "HEAD").strip()


# ---------- plan task-id extraction ------------------------------------


def test_plan_task_ids_from_text() -> None:
    plan = (
        "## Phase 1\n### T1.1 — Foo\nbody\n### T1.2 — Bar\nbody\n"
        "## Phase 2\n### T2.1 — Baz\n"
    )
    assert plan_task_ids_from_text(plan) == ["T1.1", "T1.2", "T2.1"]


# ---------- forward: committed task must have a real SHA ---------------


def test_committed_sha_not_in_git_is_high(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    _commit(repo, "src/a.py", "x = 1\n", "feat: a\n\nT1.1: foo")
    progress = {"tasks": [
        {"id": "T1.1", "phase": "1", "status": "committed", "commit_sha": "deadbeefdeadbeef"},
    ]}
    report = check_checkpoint_consistency(progress, repo, ["T1.1"])
    codes = [f.code for f in report.findings]
    assert "committed_sha_not_in_git" in codes
    assert report.has_high_or_blocker is True


# ---------- backward: task committed in git must be in the checkpoint --


def test_task_committed_in_git_but_not_in_progress_is_high(tmp_path: Path) -> None:
    """The exact gap: T1.2 was committed (its id is in a real commit body) but the
    halt-loop forgot to record it in the checkpoint."""
    repo = _repo(tmp_path)
    sha1 = _commit(repo, "src/a.py", "x = 1\n", "feat: a\n\nT1.1: foo")
    _commit(repo, "src/b.py", "y = 2\n", "feat: b\n\nT1.2: bar")  # committed in git
    progress = {"tasks": [
        {"id": "T1.1", "phase": "1", "status": "committed", "commit_sha": sha1},
        # T1.2 MISSING from the checkpoint
    ]}
    report = check_checkpoint_consistency(progress, repo, ["T1.1", "T1.2"])
    findings = {f.code for f in report.findings}
    assert "task_committed_in_git_not_in_progress" in findings
    msgs = " ".join(f.message for f in report.findings)
    assert "T1.2" in msgs


def test_task_present_but_not_committed_status_is_flagged(tmp_path: Path) -> None:
    """T1.2 has a real commit but the checkpoint still marks it 'green' (stale)."""
    repo = _repo(tmp_path)
    sha1 = _commit(repo, "src/a.py", "x = 1\n", "feat: a\n\nT1.1: foo")
    _commit(repo, "src/b.py", "y = 2\n", "feat: b\n\nT1.2: bar")
    progress = {"tasks": [
        {"id": "T1.1", "phase": "1", "status": "committed", "commit_sha": sha1},
        {"id": "T1.2", "phase": "1", "status": "green"},  # stale: committed in git, not here
    ]}
    report = check_checkpoint_consistency(progress, repo, ["T1.1", "T1.2"])
    assert "task_committed_in_git_not_in_progress" in {f.code for f in report.findings}


# ---------- consistent + not-yet-done cases ---------------------------


def test_consistent_checkpoint_has_no_findings(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    sha1 = _commit(repo, "src/a.py", "x = 1\n", "feat: a\n\nT1.1: foo")
    sha2 = _commit(repo, "src/b.py", "y = 2\n", "feat: b\n\nT1.2: bar")
    progress = {"tasks": [
        {"id": "T1.1", "phase": "1", "status": "committed", "commit_sha": sha1},
        {"id": "T1.2", "phase": "1", "status": "committed", "commit_sha": sha2},
    ]}
    report = check_checkpoint_consistency(progress, repo, ["T1.1", "T1.2"])
    assert report.findings == ()
    assert report.status == "PASS"


def test_not_yet_committed_task_is_not_flagged(tmp_path: Path) -> None:
    """T1.3 is in the plan but has no commit yet and is pending — that's fine."""
    repo = _repo(tmp_path)
    sha1 = _commit(repo, "src/a.py", "x = 1\n", "feat: a\n\nT1.1: foo")
    progress = {"tasks": [
        {"id": "T1.1", "phase": "1", "status": "committed", "commit_sha": sha1},
        {"id": "T1.3", "phase": "1", "status": "pending"},
    ]}
    report = check_checkpoint_consistency(progress, repo, ["T1.1", "T1.3"])
    assert report.findings == ()


def test_empty_progress_no_commits_is_pass(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    _commit(repo, "README.md", "# hi\n", "docs: init")  # unrelated, no task id
    report = check_checkpoint_consistency({"tasks": []}, repo, ["T1.1"])
    assert report.status == "PASS"
