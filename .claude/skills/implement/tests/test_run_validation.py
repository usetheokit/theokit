"""Tests for run_validation.py — verifies graceful pre-code SKIP + integration."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


SCRIPT = Path(__file__).parent.parent / "scripts" / "run_validation.py"

from run_validation import wiring_summary  # noqa: E402 — conftest puts scripts/ on sys.path


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args],
                          capture_output=True, text=True, check=True).stdout


def _init_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    (repo / "src").mkdir(parents=True)
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "t@t.t")
    _git(repo, "config", "user.name", "t")
    return repo


def _commit(repo: Path, rel: str, content: str, msg: str = "feat") -> str:
    path = repo / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    _git(repo, "add", rel)
    _git(repo, "commit", "-q", "-m", msg)
    return _git(repo, "rev-parse", "HEAD").strip()


def _write_progress(project_root: Path, tasks: list[dict], slug: str = "wsg") -> None:
    impl_dir = project_root / ".claude" / "knowledge-base" / "implementations"
    impl_dir.mkdir(parents=True, exist_ok=True)
    (impl_dir / f".progress-{slug}.json").write_text(
        json.dumps({"slug": slug, "tasks": tasks}), encoding="utf-8"
    )


def test_wiring_summary_detects_fabricated_evidence(tmp_path: Path) -> None:
    """GAP 3: self-reported pillar (a) pass + an actually-uncalled symbol = fabrication.

    The final gate must NOT trust the progress file: it re-derives symbols from the
    committed diff and re-runs check_wiring. A dishonest `wiring.a=pass` over an
    orphan symbol is caught as fabricated evidence, status FAIL.
    """
    repo = _init_repo(tmp_path)
    sha = _commit(repo, "src/orphan.py", "def orphan_fn(x):\n    return x\n")
    _write_progress(repo, [
        {"id": "T1.1", "phase": "1", "commit_sha": sha, "wiring": {"a": "pass"}},
    ])
    result = wiring_summary(repo, "wsg")
    assert result["status"] == "FAIL"
    assert result["fabricated_wiring_evidence"] is True
    assert "orphan_fn" in result["pillar_a_fail_symbols"]


def test_wiring_summary_passes_when_recheck_confirms_caller(tmp_path: Path) -> None:
    """A genuinely-wired symbol (real production caller) passes the independent recheck."""
    repo = _init_repo(tmp_path)
    sha = _commit(repo, "src/order.py", "def compute_total(x):\n    return x\n")
    _commit(repo, "src/app.py", "from order import compute_total\nprint(compute_total(1))\n")
    _write_progress(repo, [
        {"id": "T1.1", "phase": "1", "commit_sha": sha, "wiring": {"a": "pass"}},
    ])
    result = wiring_summary(repo, "wsg")
    assert result["status"] == "PASS"
    assert result["pillar_a_fails"] == 0


def test_wiring_summary_na_when_nothing_verifiable(tmp_path: Path) -> None:
    """No SHAs / no git → cannot re-verify → N/A, NOT a PASS laundered from a claim."""
    _write_progress(tmp_path, [
        {"id": "T1.1", "phase": "1", "wiring": {"a": "pass"}},  # no commit_sha
    ])
    result = wiring_summary(tmp_path, "wsg")
    assert result["status"] == "N/A"
    assert result["symbols_resolved"] == 0
    # The claim is preserved for audit but did NOT produce a PASS.
    assert result["self_reported_pillar_a_pass"] == 1


def _run_validation(slug: str, project_root: Path) -> tuple[int, dict]:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), slug, "--project-root", str(project_root), "--no-write-report"],
        capture_output=True,
        text=True,
    )
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = {"raw": result.stdout, "stderr": result.stderr}
    return result.returncode, data


def test_pre_code_phase_all_skip(fake_project: Path) -> None:
    """No package.json → all npm-based gates SKIP gracefully; overall=PARTIAL."""
    rc, data = _run_validation("test-slug", fake_project)
    assert rc == 0  # PARTIAL is exit 0 (no failures, just skips)
    assert data["overall_status"] == "PARTIAL"
    skips = [c for c in data["checks"] if c.get("status") == "SKIP"]
    assert len(skips) >= 4


def test_with_package_json_and_passing_scripts(fake_project: Path) -> None:
    """Package.json with test/typecheck/lint that exit 0 → all PASS (or some SKIP)."""
    (fake_project / "package.json").write_text(
        json.dumps({
            "name": "fake",
            "scripts": {
                "test": "true",  # exit 0
                "typecheck": "true",
                "lint": "true",
            }
        }),
        encoding="utf-8",
    )
    rc, data = _run_validation("test-slug", fake_project)
    # No FAILs expected; PASS or SKIP only
    fails = [c for c in data["checks"] if c.get("status") == "FAIL"]
    assert len(fails) == 0


def test_with_failing_test_script(fake_project: Path) -> None:
    """Package.json with `test` that exits 1 → npm test FAIL → overall=FAIL."""
    (fake_project / "package.json").write_text(
        json.dumps({
            "name": "fake",
            "scripts": {
                "test": "false",  # exit 1
            }
        }),
        encoding="utf-8",
    )
    rc, data = _run_validation("test-slug", fake_project)
    assert rc == 1
    assert data["overall_status"] == "FAIL"
    test_check = next(c for c in data["checks"] if c.get("name") == "npm test")
    assert test_check["status"] == "FAIL"


def test_new_gates_are_wired_into_validation(fake_project: Path) -> None:
    """GAP 1+2 / GAP 6: the acceptance-criteria and test-obligation gates must run as
    part of the final validation, not exist as orphan scripts."""
    plan_dir = fake_project / ".claude" / "knowledge-base" / "plans"
    plan_dir.mkdir(parents=True, exist_ok=True)
    (plan_dir / "test-slug-plan.md").write_text(
        "# Plan\n\n### T1.1 — X\n\n#### Acceptance Criteria\n"
        "- [ ] Backward compatibility preserved across public API\n",
        encoding="utf-8",
    )
    _, data = _run_validation("test-slug", fake_project)
    names = [c["name"] for c in data["checks"]]
    assert "acceptance_criteria" in names
    assert "test_obligations" in names
    ac = next(c for c in data["checks"] if c["name"] == "acceptance_criteria")
    assert ac["status"] != "SKIP"  # plan found → criteria actually audited


def test_checkpoint_consistency_gate_catches_unrecorded_task(tmp_path: Path) -> None:
    """End-to-end: a task committed in git but missing from the checkpoint fails the
    checkpoint_consistency gate inside run_validation."""
    repo = _init_repo(tmp_path)
    sha1 = _commit(repo, "src/a.py", "x = 1\n", "feat: a\n\nT1.1: foo")
    _commit(repo, "src/b.py", "y = 2\n", "feat: b\n\nT1.2: bar")  # committed, but not in checkpoint
    plan_dir = repo / ".claude" / "knowledge-base" / "plans"
    plan_dir.mkdir(parents=True, exist_ok=True)
    (plan_dir / "ck-plan.md").write_text(
        "## Phase 1\n### T1.1 — Foo\nbody\n### T1.2 — Bar\nbody\n", encoding="utf-8")
    _write_progress(repo, [
        {"id": "T1.1", "phase": "1", "status": "committed", "commit_sha": sha1},
    ], slug="ck")

    rc, data = _run_validation("ck", repo)
    cc = next(c for c in data["checks"] if c["name"] == "checkpoint_consistency")
    assert cc["status"] == "FAIL"
    assert "task_committed_in_git_not_in_progress" in [f["code"] for f in cc["findings"]]
    assert rc == 1


def test_malformed_checkpoint_fails_validation(fake_project: Path) -> None:
    """The progress-schema gate must catch a malformed checkpoint (the prompt's old
    bare-object shape) and FAIL the whole validation, not let gates degrade silently."""
    impl = fake_project / ".claude" / "knowledge-base" / "implementations"
    impl.mkdir(parents=True, exist_ok=True)
    (impl / ".progress-test-slug.json").write_text(
        json.dumps({"task_id": "T1.1", "status": "committed"}),  # no 'tasks' envelope
        encoding="utf-8",
    )
    rc, data = _run_validation("test-slug", fake_project)
    ps = next(c for c in data["checks"] if c["name"] == "progress_schema")
    assert ps["status"] == "FAIL"
    assert "progress_missing_tasks" in [f["code"] for f in ps["findings"]]
    assert rc == 1
    assert data["overall_status"] == "FAIL"


def test_summary_buckets_account_for_every_check(fake_project: Path) -> None:
    """Regression: pass+fail+skip+warn+partial+n_a must equal total — WARN and
    PARTIAL statuses (from the code-quality gate) used to be dropped from the summary."""
    _, data = _run_validation("test-slug", fake_project)
    s = data["summary"]
    for bucket in ("pass", "fail", "skip", "warn", "partial", "n_a"):
        assert bucket in s, f"summary missing bucket '{bucket}'"
    assert s["pass"] + s["fail"] + s["skip"] + s["warn"] + s["partial"] + s["n_a"] == s["total"]


# T2.1 — patterns-consumption advisory (patterns-consumption-gate-plan, ADR D3)

from run_validation import check_patterns_advisory  # noqa: E402


def test_patterns_advisory_never_fails(tmp_path: Path) -> None:
    plans = tmp_path / ".claude" / "knowledge-base" / "plans"
    plans.mkdir(parents=True)
    (plans / "demo-plan.md").write_text(
        "# Plan: demo\n## Prior Art & Related Work\n- Patterns skills: `foo-patterns` Pattern P1.\n"
    )
    src = tmp_path / "src"
    src.mkdir()
    (src / "impl.py").write_text("print('no skill mention here')\n")
    impl = tmp_path / ".claude" / "knowledge-base" / "implementations"
    impl.mkdir(parents=True)
    (impl / ".progress-demo.json").write_text(json.dumps({
        "slug": "demo",
        "tasks": [{"id": "T1.1", "phase": "1", "status": "committed", "files": ["src/impl.py"]}],
    }))
    r = check_patterns_advisory(tmp_path, "demo")
    assert r["status"] == "WARN"           # advisory, surfaced
    assert r["status"] != "FAIL"           # never blocks handoff (ADR D3)
    assert "foo-patterns" in r["not_found"]


def test_patterns_advisory_absent_when_no_citation(tmp_path: Path) -> None:
    plans = tmp_path / ".claude" / "knowledge-base" / "plans"
    plans.mkdir(parents=True)
    (plans / "demo-plan.md").write_text("# Plan: demo\n## Goal\nNothing special here.\n")
    r = check_patterns_advisory(tmp_path, "demo")
    assert r["status"] == "N/A"
