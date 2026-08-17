#!/usr/bin/env python3
"""TDD shape gate for /implement Step 2 — defense in depth against vague plans.

Validates that every task block in a plan has a `#### TDD` section whose body
contains at least ONE of three executable RED-test shapes:

  (1) assertion shape    — assert*(X, Y) / expect(X).to(...) / X should equal Y
  (2) Given/When/Then    — explicit GWT keywords in order
  (3) test-function shape — `test_<behavior>(<input>) -> <expected>` literal

A task whose TDD section is missing OR contains only prose (no executable
shape) is flagged. /implement Step 2 SHOULD halt the halt-loop for any
such task with BLOCKED — they cannot drive a TDD RED phase.

Companion gate to skills/plan-confidence/scripts/check_criterion_executability.py
(plan-side). This one is the implement-side defense in depth: even if
plan-confidence's heuristic missed a vague criterion, /implement still
refuses to drive a task without an executable test shape.

Usage:
    python3 check_tdd_shape.py --plan knowledge-base/plans/foo-plan.md

Exit codes:
    0 — every task has an executable TDD shape
    1 — at least one task lacks an executable TDD shape (BLOCKED)
    2 — file not found / parse error
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

TASK_HEADER_RE = re.compile(r"^###\s+(T\d+\.\d+)\s*[—\-–:]\s*(.+?)\s*$", re.MULTILINE)
NEXT_TASK_OR_H2_RE = re.compile(r"^(##\s+\S|###\s+T\d+\.\d+)", re.MULTILINE)
TDD_BLOCK_RE = re.compile(r"^####\s+TDD\s*$", re.MULTILINE)
NEXT_H4_RE = re.compile(r"^####\s+\S", re.MULTILINE)

# Shape 1: assertion API (broad — handles xunit / Jest / RSpec / chai / pytest)
SHAPE_ASSERTION_PATTERNS = (
    r"\bassert(?:Equals?|True|False|Raises|That|In|NotEqual|NotNull|Null|Throws)\s*\(",
    # `assert X (op) Y` where X may be dotted (response.body, result.status_code)
    r"\bassert\s+[\w.\[\]]+\s*(?:==|!=|<=|>=|<|>|\bin\b|\bis\b)",
    r"\bexpect\s*\([^)]+\)\s*\.\s*(?:to|toBe|toEqual|toMatch|toHaveBeenCalled)",
    # "X should equal/raise/throw Y" — RSpec/Chai style — must name the expected value
    # (excludes vibe phrases like "tests should be green" by requiring object after verb)
    r"\b\w+\s+should\s+(?:equal|raise|throw|return|contain)\s+\S",
    r"\.assert(?:Equal|True|False)\b",
)

# Shape 2: Given/When/Then (BDD)
SHAPE_GWT_PATTERN = re.compile(
    r"\bgiven\b.{1,500}?\bwhen\b.{1,500}?\bthen\b",
    re.IGNORECASE | re.DOTALL,
)

# Shape 3: test-function literal `test_xxx(input) -> output`
SHAPE_TEST_FN_PATTERNS = (
    r"\btest_\w+\s*\([^)]*\)\s*(?:->|=>|returns?|expects?)",
    r"\bRED:\s*test_\w+",  # plans commonly write "RED: test_xxx_yyy" — that's a shape
)


@dataclass(frozen=True)
class TaskShape:
    task_id: str
    title: str
    has_tdd_block: bool
    has_assertion_shape: bool
    has_gwt_shape: bool
    has_test_fn_shape: bool

    @property
    def has_executable_shape(self) -> bool:
        return self.has_tdd_block and (
            self.has_assertion_shape or self.has_gwt_shape or self.has_test_fn_shape
        )


@dataclass(frozen=True)
class ShapeReport:
    total_tasks: int
    tasks_with_shape: int
    tasks: tuple[TaskShape, ...] = field(default_factory=tuple)

    @property
    def blocked_tasks(self) -> tuple[TaskShape, ...]:
        return tuple(t for t in self.tasks if not t.has_executable_shape)

    @property
    def all_pass(self) -> bool:
        return len(self.blocked_tasks) == 0


def _extract_task_blocks(content: str) -> list[tuple[str, str, str]]:
    """Return list of (task_id, title, body) — body stops at next task/H2."""
    matches = list(TASK_HEADER_RE.finditer(content))
    blocks: list[tuple[str, str, str]] = []
    for m in matches:
        tid = m.group(1)
        title = m.group(2).strip()
        start = m.end()
        nxt = NEXT_TASK_OR_H2_RE.search(content, pos=start)
        end = nxt.start() if nxt else len(content)
        blocks.append((tid, title, content[start:end]))
    return blocks


def _extract_tdd_section(task_body: str) -> str | None:
    """Return the body of the #### TDD section in this task, or None if absent."""
    tdd_match = TDD_BLOCK_RE.search(task_body)
    if tdd_match is None:
        return None
    after = task_body[tdd_match.end():]
    next_h4 = NEXT_H4_RE.search(after)
    return after[: next_h4.start()] if next_h4 else after


def _has_assertion_shape(text: str) -> bool:
    return any(re.search(p, text) for p in SHAPE_ASSERTION_PATTERNS)


def _has_gwt_shape(text: str) -> bool:
    return SHAPE_GWT_PATTERN.search(text) is not None


def _has_test_fn_shape(text: str) -> bool:
    return any(re.search(p, text) for p in SHAPE_TEST_FN_PATTERNS)


def check_tdd_shape(plan_path: Path) -> ShapeReport:
    content = plan_path.read_text(encoding="utf-8-sig")
    task_blocks = _extract_task_blocks(content)

    shapes: list[TaskShape] = []
    for tid, title, body in task_blocks:
        tdd_body = _extract_tdd_section(body)
        if tdd_body is None:
            shapes.append(TaskShape(
                task_id=tid, title=title, has_tdd_block=False,
                has_assertion_shape=False, has_gwt_shape=False, has_test_fn_shape=False,
            ))
            continue
        shapes.append(TaskShape(
            task_id=tid,
            title=title,
            has_tdd_block=True,
            has_assertion_shape=_has_assertion_shape(tdd_body),
            has_gwt_shape=_has_gwt_shape(tdd_body),
            has_test_fn_shape=_has_test_fn_shape(tdd_body),
        ))

    return ShapeReport(
        total_tasks=len(shapes),
        tasks_with_shape=sum(1 for s in shapes if s.has_executable_shape),
        tasks=tuple(shapes),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON report")
    args = parser.parse_args()

    if not args.plan.exists():
        print(f"file not found: {args.plan}", file=sys.stderr)
        return 2

    report = check_tdd_shape(args.plan)

    if args.json:
        out = {
            "total_tasks": report.total_tasks,
            "tasks_with_shape": report.tasks_with_shape,
            "blocked_task_ids": [t.task_id for t in report.blocked_tasks],
            "blocked_reasons": [
                {
                    "task_id": t.task_id,
                    "title": t.title,
                    "reason": (
                        "no #### TDD section in task body"
                        if not t.has_tdd_block
                        else "TDD section has no executable shape "
                             "(assertion / Given-When-Then / test_fn)"
                    ),
                }
                for t in report.blocked_tasks
            ],
            "all_pass": report.all_pass,
        }
        print(json.dumps(out, indent=2))
    else:
        print(f"Total tasks: {report.total_tasks}")
        print(f"With executable TDD shape: {report.tasks_with_shape}")
        for t in report.blocked_tasks:
            reason = (
                "no #### TDD section"
                if not t.has_tdd_block
                else "TDD section has no executable shape"
            )
            print(f"  BLOCKED {t.task_id} ({t.title}): {reason}")

    return 0 if report.all_pass else 1


if __name__ == "__main__":
    sys.exit(main())
