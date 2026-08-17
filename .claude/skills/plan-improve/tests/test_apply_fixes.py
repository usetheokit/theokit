"""TDD for apply_fixes.py — deterministic plan-improve fixes."""
from __future__ import annotations

from pathlib import Path


from apply_fixes import (  # noqa: E402
    FixReport,
    apply_all_fixes,
    fix_loopholes,
    fix_tdd_template,
    fix_weak_imperatives,
    is_inside_code_block,
)


def _write(tmp_path: Path, content: str, name: str = "plan.md") -> Path:
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


# Fix 1: weak imperatives

def test_weak_imperative_should_replaced_in_prose(tmp_path: Path) -> None:
    plan = _write(tmp_path, "The system should handle errors.\n")
    report = fix_weak_imperatives(plan, dry_run=False)
    content = plan.read_text(encoding="utf-8")
    assert "should" not in content
    assert "must" in content
    assert report.changes_applied >= 1


def test_weak_imperative_could_replaced(tmp_path: Path) -> None:
    plan = _write(tmp_path, "This could fail.\n")
    fix_weak_imperatives(plan, dry_run=False)
    assert "must" in plan.read_text(encoding="utf-8")


def test_weak_imperative_inside_code_block_preserved(tmp_path: Path) -> None:
    plan = _write(
        tmp_path,
        "```python\ndef test_should_pass():\n    pass\n```\n",
    )
    fix_weak_imperatives(plan, dry_run=False)
    content = plan.read_text(encoding="utf-8")
    assert "test_should_pass" in content


def test_weak_imperative_dry_run_does_not_modify_file(tmp_path: Path) -> None:
    original = "The system should work.\n"
    plan = _write(tmp_path, original)
    report = fix_weak_imperatives(plan, dry_run=True)
    assert plan.read_text(encoding="utf-8") == original
    assert report.changes_proposed >= 1


def test_weak_imperative_idempotent(tmp_path: Path) -> None:
    plan = _write(tmp_path, "The system should work.\n")
    fix_weak_imperatives(plan, dry_run=False)
    after1 = plan.read_text(encoding="utf-8")
    r2 = fix_weak_imperatives(plan, dry_run=False)
    assert plan.read_text(encoding="utf-8") == after1
    assert r2.changes_applied == 0


# Fix 2: loopholes

def test_loophole_if_possible_removed(tmp_path: Path) -> None:
    plan = _write(tmp_path, "Apply X if possible.\n")
    fix_loopholes(plan, dry_run=False)
    content = plan.read_text(encoding="utf-8")
    assert "if possible" not in content


def test_loophole_when_applicable_removed(tmp_path: Path) -> None:
    plan = _write(tmp_path, "Use X when applicable.\n")
    fix_loopholes(plan, dry_run=False)
    assert "when applicable" not in plan.read_text(encoding="utf-8")


def test_loophole_inside_code_block_preserved(tmp_path: Path) -> None:
    plan = _write(tmp_path, "```\nApply if possible\n```\n")
    fix_loopholes(plan, dry_run=False)
    assert "if possible" in plan.read_text(encoding="utf-8")


def test_loophole_idempotent(tmp_path: Path) -> None:
    plan = _write(tmp_path, "Apply X if possible.\n")
    fix_loopholes(plan, dry_run=False)
    after1 = plan.read_text(encoding="utf-8")
    fix_loopholes(plan, dry_run=False)
    assert plan.read_text(encoding="utf-8") == after1


# Fix 3: TDD template

def test_tdd_injected_in_bugfix_task_without_tdd(tmp_path: Path) -> None:
    plan = _write(
        tmp_path,
        "### T1.1 — Fix the parser bug\n\n"
        "#### Objective\nResolve bug.\n\n"
        "#### Acceptance Criteria\n- [ ] Bug gone\n",
    )
    fix_tdd_template(plan, dry_run=False)
    content = plan.read_text(encoding="utf-8")
    assert "#### TDD" in content
    assert "RED:" in content
    assert "GREEN:" in content


def test_tdd_not_injected_in_non_bugfix_task(tmp_path: Path) -> None:
    plan = _write(
        tmp_path,
        "### T1.1 — Add new feature\n\n"
        "#### Objective\nAdd thing.\n\n"
        "#### Acceptance Criteria\n- [ ] Done\n",
    )
    fix_tdd_template(plan, dry_run=False)
    assert "#### TDD" not in plan.read_text(encoding="utf-8")


def test_tdd_not_injected_if_already_present(tmp_path: Path) -> None:
    plan = _write(
        tmp_path,
        "### T1.1 — Fix the parser bug\n\n"
        "#### TDD\n```\nRED: test_x\nGREEN: implement\n```\n\n"
        "#### Acceptance Criteria\n- [ ] OK\n",
    )
    fix_tdd_template(plan, dry_run=False)
    assert plan.read_text(encoding="utf-8").count("#### TDD") == 1


def test_tdd_template_injection_idempotent(tmp_path: Path) -> None:
    plan = _write(
        tmp_path,
        "### T1.1 — Fix the bug\n\n"
        "#### Objective\nx\n\n"
        "#### Acceptance Criteria\n- [ ] OK\n",
    )
    fix_tdd_template(plan, dry_run=False)
    after1 = plan.read_text(encoding="utf-8")
    fix_tdd_template(plan, dry_run=False)
    assert plan.read_text(encoding="utf-8") == after1


# Code-block detection

def test_is_inside_code_block_tracks_state() -> None:
    lines = ["prose 1", "```py", "code", "```", "prose 2"]
    state = [is_inside_code_block(lines[: i + 1]) for i in range(len(lines))]
    assert state[0] is False
    assert state[2] is True
    assert state[4] is False


# Orchestrator

def test_apply_all_fixes_combines_all_three(tmp_path: Path) -> None:
    plan = _write(
        tmp_path,
        "The system should handle errors if possible.\n\n"
        "### T1.1 — Fix the parser bug\n\n"
        "#### Acceptance Criteria\n- [ ] OK\n",
    )
    report = apply_all_fixes(plan, dry_run=False)
    content = plan.read_text(encoding="utf-8")
    assert "should" not in content
    assert "if possible" not in content
    assert "#### TDD" in content
    assert report.total_changes_applied >= 3


def test_apply_all_fixes_dry_run(tmp_path: Path) -> None:
    original = "should be done if possible\n"
    plan = _write(tmp_path, original)
    report = apply_all_fixes(plan, dry_run=True)
    assert plan.read_text(encoding="utf-8") == original
    assert report.total_changes_proposed >= 2


def test_apply_all_fixes_idempotent(tmp_path: Path) -> None:
    plan = _write(
        tmp_path,
        "The system should handle if possible.\n\n"
        "### T1.1 — Fix bug\n\n"
        "#### Acceptance Criteria\n- [ ] OK\n",
    )
    apply_all_fixes(plan, dry_run=False)
    after1 = plan.read_text(encoding="utf-8")
    apply_all_fixes(plan, dry_run=False)
    assert plan.read_text(encoding="utf-8") == after1


def test_fix_report_dataclass_fields() -> None:
    r = FixReport(category="weak_imperatives", changes_proposed=3, changes_applied=3)
    assert r.category == "weak_imperatives"
    assert r.changes_proposed == 3
    assert r.changes_applied == 3
