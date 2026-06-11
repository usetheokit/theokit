"""TDD presence check in bug-fix tasks.

A task is identified as "bug-fix" when its description contains "bug-fix",
"bug fix", "regression", or "fix a bug" (case-insensitive).

A task has TDD iff its body has a #### TDD block with RED/GREEN keywords.

Returns TDDReport.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

TASK_HEADER_RE = re.compile(r"^###\s+(T\d+\.\d+)\s*[—\-–:]\s*(.+)$", re.MULTILINE)
TDD_BLOCK_RE = re.compile(r"^####\s+TDD\s*$", re.MULTILINE)
NEXT_TASK_OR_H2_RE = re.compile(r"^(##\s+\S|###\s+T\d+\.\d+)", re.MULTILINE)

BUGFIX_KEYWORDS = (
    "bug-fix",
    "bug fix",
    "bugfix",
    "regression",
    "fix a bug",
    "fix the bug",
    "resolve a bug",
    # Aligned with apply_fixes (Fix #4) for consistency
    "fix bug",
    "parser bug",
    "fix.+bug",  # not used as substring; left for grep-of-the-mind
)


@dataclass(frozen=True)
class TDDReport:
    total_bugfix_tasks: int
    with_tdd: int
    coverage_ratio: float
    missing_tdd: tuple[str, ...] = field(default_factory=tuple)


def _find_task_blocks(content: str) -> list[tuple[str, str, str]]:
    """Return list of (task_id, task_title, body).

    Body stops at the next task header OR the next H2 section (whichever comes first).
    This prevents the last task's body from absorbing the Coverage Matrix or other
    H2 sections, which would create false-positive bugfix matches (e.g., "regression"
    in matrix descriptions).
    """
    matches = list(TASK_HEADER_RE.finditer(content))
    blocks: list[tuple[str, str, str]] = []
    for m in matches:
        tid = m.group(1)
        title = m.group(2).strip()
        start = m.end()
        # End at next task OR next H2 OR end of file
        next_match = NEXT_TASK_OR_H2_RE.search(content, pos=start)
        end = next_match.start() if next_match else len(content)
        body = content[start:end]
        blocks.append((tid, title, body))
    return blocks


def _is_bugfix(title: str, body: str) -> bool:
    """Detect bug-fix tasks by TITLE only (v1.1 follow-up to EC-9).

    Body mentions of 'bug-fix' are typically rule descriptions in meta-docs
    (e.g., 'Each bug-fix task must have TDD'). Real bug-fix tasks have keyword
    in their title (e.g., 'Fix parser bug', 'Add regression test for X').
    """
    title_low = title.lower()
    return any(kw in title_low for kw in BUGFIX_KEYWORDS)


def _has_tdd_block(body: str) -> bool:
    """Check for #### TDD block with RED + GREEN markers."""
    tdd_match = TDD_BLOCK_RE.search(body)
    if tdd_match is None:
        return False
    # Look for RED and GREEN keywords within ~30 lines of the TDD header
    after = body[tdd_match.end():]
    upper = after.upper()
    return "RED:" in upper or "RED " in upper


def check_tdd_in_bugfix(plan_path: Path) -> TDDReport:
    content = plan_path.read_text(encoding="utf-8-sig")
    blocks = _find_task_blocks(content)

    bugfix_tasks = [(tid, body) for tid, title, body in blocks if _is_bugfix(title, body)]
    total = len(bugfix_tasks)

    if total == 0:
        return TDDReport(
            total_bugfix_tasks=0,
            with_tdd=0,
            coverage_ratio=1.0,  # No bug-fix tasks == vacuously complete
            missing_tdd=(),
        )

    with_tdd = 0
    missing: list[str] = []
    for tid, body in bugfix_tasks:
        if _has_tdd_block(body):
            with_tdd += 1
        else:
            missing.append(tid)

    return TDDReport(
        total_bugfix_tasks=total,
        with_tdd=with_tdd,
        coverage_ratio=with_tdd / total,
        missing_tdd=tuple(sorted(missing)),
    )
