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


def _mk(p: Path) -> Path:
    p.mkdir(parents=True, exist_ok=True)
    return p


# ---------- cross-repo tasks -------------------------------------------
#
# A plan may legitimately span two repositories — this one does, and its `#### Files to edit`
# sections name `../theokit-sdk/...` explicitly. When a task's whole commit lands in the sibling,
# `commit_sha` holds a SHA this repo has never seen, and the forward check reported it as
# "fabricated or stale". It was neither: it was unverifiable, and the check could not tell the two
# apart.
#
# So a task may declare `repo`, and the SHA is then verified THERE. This widens what gets checked —
# a cross-repo SHA went from unverifiable to verified — and must not become a way to skip the check:
# the last three tests below are the ones that matter, because they are the escape hatches a
# `repo` field would open if it were implemented carelessly.


def test_cross_repo_commit_is_verified_in_the_declared_repo(tmp_path: Path) -> None:
    main, sibling = _repo(_mk(tmp_path / "a")), _repo(_mk(tmp_path / "b"))
    _commit(main, "f.txt", "x", "T1.1 local work")
    sha = _commit(sibling, "g.txt", "y", "T1.2 sibling work")

    report = check_checkpoint_consistency(
        {"tasks": [{"id": "T1.2", "status": "committed", "commit_sha": sha,
                    "repo": str(sibling)}]},
        main, ["T1.2"],
    )
    assert [f.code for f in report.findings if f.severity == "HIGH"] == []


def test_cross_repo_sha_that_does_not_exist_there_still_fails(tmp_path: Path) -> None:
    main, sibling = _repo(_mk(tmp_path / "a")), _repo(_mk(tmp_path / "b"))
    _commit(sibling, "g.txt", "y", "T1.2 sibling work")

    report = check_checkpoint_consistency(
        {"tasks": [{"id": "T1.2", "status": "committed",
                    "commit_sha": "0" * 40, "repo": str(sibling)}]},
        main, ["T1.2"],
    )
    assert "committed_sha_not_in_git" in {f.code for f in report.findings}


def test_repo_pointing_at_a_non_repository_fails(tmp_path: Path) -> None:
    # The obvious escape hatch: name a path that is not a git repo, and hope the check gives up
    # quietly. `git -C` fails there, so the SHA stays unverified — which is a FAILURE, not a pass.
    main = _repo(_mk(tmp_path / "a"))
    plain = tmp_path / "not-a-repo"
    plain.mkdir()

    report = check_checkpoint_consistency(
        {"tasks": [{"id": "T1.2", "status": "committed", "commit_sha": "0" * 40,
                    "repo": str(plain)}]},
        main, ["T1.2"],
    )
    assert "committed_sha_not_in_git" in {f.code for f in report.findings}


def test_repo_pointing_nowhere_fails(tmp_path: Path) -> None:
    main = _repo(_mk(tmp_path / "a"))
    report = check_checkpoint_consistency(
        {"tasks": [{"id": "T1.2", "status": "committed", "commit_sha": "0" * 40,
                    "repo": str(tmp_path / "vanished")}]},
        main, ["T1.2"],
    )
    assert "committed_sha_not_in_git" in {f.code for f in report.findings}


def test_a_local_task_is_still_checked_against_the_main_repo(tmp_path: Path) -> None:
    # The single-repo path must be untouched: no `repo` means this repo, and a bad SHA still fails.
    main = _repo(_mk(tmp_path / "a"))
    _commit(main, "f.txt", "x", "T1.1 local work")
    report = check_checkpoint_consistency(
        {"tasks": [{"id": "T1.1", "status": "committed", "commit_sha": "0" * 40}]},
        main, ["T1.1"],
    )
    assert "committed_sha_not_in_git" in {f.code for f in report.findings}


# ---------- the reverse check's two false-positive sources ---------------
#
# Both were measured by the 2026-08-16 review, which found this gate blocking `/review`'s own
# pre-condition with four findings that were all wrong:
#
#   (a) The id scan reads `git log -n 500` over ALL recent history with no plan scoping. Task ids
#       are generic, so a commit from a DIFFERENT plan that used `T5.1` flags this plan's T5.1.
#       Measured: `99d5ec57 feat(scripts): T5.1 — o gate de paridade…` and
#       `e3595b4b docs(plan): T5.2 dispara o gatilho…`, neither on the branch under test.
#   (b) A task recorded `blocked` WITH a reason is not a forgotten checkpoint update — it is an
#       explicit declaration, already reported at HIGH by `phase_has_blocked_tasks`. Treating it
#       like `pending` turns "I wrote down why this cannot proceed" into a failure.
#
# The tests that must KEEP failing are written first, because a fix to a false positive that also
# silences the true positive is not a fix.


def test_a_commit_from_another_branch_does_not_flag_this_plans_task(tmp_path: Path) -> None:
    repo = _repo(_mk(tmp_path / "a"))
    # An older commit that merely MENTIONS the id — the shape of a different plan's history.
    _commit(repo, "old.txt", "x", "T5.1 — some other plan's gate work")
    _git(repo, "switch", "-c", "workspace")
    base = _git(repo, "rev-parse", "HEAD").strip()
    _commit(repo, "new.txt", "y", "feat: unrelated work on this branch")

    report = check_checkpoint_consistency(
        {"tasks": [{"id": "T5.1", "status": "pending"}]},
        repo, ["T5.1"], base=base,
    )
    assert "task_committed_in_git_not_in_progress" not in {f.code for f in report.findings}


def test_a_commit_on_this_branch_still_flags_a_stale_checkpoint(tmp_path: Path) -> None:
    # The true positive the whole check exists for: the work landed here and nobody updated it.
    repo = _repo(_mk(tmp_path / "a"))
    _commit(repo, "old.txt", "x", "unrelated")
    base = _git(repo, "rev-parse", "HEAD").strip()
    _commit(repo, "new.txt", "y", "feat(thing): T2.9 implemented")

    report = check_checkpoint_consistency(
        {"tasks": [{"id": "T2.9", "status": "pending"}]},
        repo, ["T2.9"], base=base,
    )
    assert "task_committed_in_git_not_in_progress" in {f.code for f in report.findings}


def test_a_blocked_task_with_a_reason_is_not_flagged(tmp_path: Path) -> None:
    repo = _repo(_mk(tmp_path / "a"))
    _commit(repo, "a.txt", "x", "unrelated")
    base = _git(repo, "rev-parse", "HEAD").strip()
    # The commit mentions the id while EXPLAINING the blockage — this plan's own shape.
    _commit(repo, "b.txt", "y", "docs: why T5.0 is blocked on the release gate")

    report = check_checkpoint_consistency(
        {"tasks": [{"id": "T5.0", "status": "blocked", "blocked_reason": "release gate"}]},
        repo, ["T5.0"], base=base,
    )
    assert "task_committed_in_git_not_in_progress" not in {f.code for f in report.findings}


def test_a_blocked_task_WITHOUT_a_reason_is_still_flagged(tmp_path: Path) -> None:
    # The escape hatch must not be free. `blocked` with no reason is not a declaration, it is a
    # status nobody justified — exactly what a stale checkpoint looks like.
    repo = _repo(_mk(tmp_path / "a"))
    _commit(repo, "a.txt", "x", "unrelated")
    base = _git(repo, "rev-parse", "HEAD").strip()
    _commit(repo, "b.txt", "y", "feat: T5.0 done")

    report = check_checkpoint_consistency(
        {"tasks": [{"id": "T5.0", "status": "blocked"}]},
        repo, ["T5.0"], base=base,
    )
    assert "task_committed_in_git_not_in_progress" in {f.code for f in report.findings}


def test_an_unresolvable_base_falls_back_rather_than_reporting_nothing(tmp_path: Path) -> None:
    # A detached CI checkout may have no base. Silently checking nothing would be the worst
    # outcome: a gate that reports clean because it could not look.
    repo = _repo(_mk(tmp_path / "a"))
    _commit(repo, "a.txt", "x", "feat: T3.7 implemented")

    report = check_checkpoint_consistency(
        {"tasks": [{"id": "T3.7", "status": "pending"}]},
        repo, ["T3.7"], base="refs/heads/does-not-exist",
    )
    assert "task_committed_in_git_not_in_progress" in {f.code for f in report.findings}
