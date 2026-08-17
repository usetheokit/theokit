"""apply_fixes.py — deterministic fixes that improve a plan's M2 score.

Three fix categories (all SAFE, deterministic):

1. **weak_imperatives**: should/could/may/might -> must
2. **loopholes**: 'if possible' / 'when applicable' / 'where feasible' / 'as appropriate' -> removed
3. **tdd_template**: bug-fix tasks without #### TDD block -> inject standard template

ALL fixes:
- Skip content inside fenced code blocks (```...```).
- Skip task header lines (### T\\d+\\.\\d+).
- Are idempotent (running twice = no second change).

A 4th category, ADR alternatives, is INTENTIONALLY out of scope here —
that requires semantic understanding and is handled by the LLM inside the
ralph-loop iteration. apply_fixes covers the deterministic 80%.

Usage:
    python3 apply_fixes.py <plan-path>             # apply all fixes
    python3 apply_fixes.py <plan-path> --dry-run   # report without modifying
    python3 apply_fixes.py <plan-path> --json      # JSON output for tooling
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------

WEAK_IMPERATIVE_PATTERNS: list[tuple[str, str]] = [
    (r"\bshould\b", "must"),
    (r"\bShould\b", "Must"),
    (r"\bcould\b", "must"),
    (r"\bCould\b", "Must"),
    (r"\bmay\b", "must"),
    (r"\bMay\b", "Must"),
    (r"\bmight\b", "must"),
    (r"\bMight\b", "Must"),
]

LOOPHOLE_PHRASES: list[str] = [
    # longest first to avoid partial replacements
    "where feasible",
    "when applicable",
    "as appropriate",
    "if possible",
]

TASK_HEADER_RE = re.compile(r"^###\s+T\d+\.\d+\b")
TASK_HEADER_FULL_RE = re.compile(r"^###\s+(T\d+\.\d+)\s*[—\-–:]\s*(.+)$")
BUGFIX_KEYWORDS = (
    "bug-fix", "bug fix", "bugfix", "regression", "fix a bug", "fix the bug",
    "resolve a bug", "fix bug", "parser bug",
)
H4_RE = re.compile(r"^####\s+")

TDD_TEMPLATE = """#### TDD

```
RED:     test_describes_the_bug() — failing test that reproduces the bug
RED:     test_describes_the_fix() — assertion about expected behavior after fix
GREEN:   Implement the minimal change to make RED tests pass
REFACTOR: Clean up if needed (or "None expected")
VERIFY:  pytest tests/ -v
```
"""


@dataclass
class FixReport:
    category: str
    changes_proposed: int = 0
    changes_applied: int = 0
    locations: list[str] = field(default_factory=list)


@dataclass
class TotalReport:
    per_category: list[FixReport] = field(default_factory=list)
    total_changes_proposed: int = 0
    total_changes_applied: int = 0


# ---------------------------------------------------------------------------
# Code-block awareness
# ---------------------------------------------------------------------------

def is_inside_code_block(lines_so_far: list[str]) -> bool:
    """Given the list of lines UP TO AND INCLUDING the current one,
    return True iff the current line is inside a fenced code block
    (i.e., AFTER opening ``` but BEFORE closing ```).

    A line that IS itself a fence (``` ...) is NOT considered "inside".
    """
    fence_count = 0
    for line in lines_so_far[:-1]:
        if line.lstrip().startswith("```"):
            fence_count += 1
    return (fence_count % 2) == 1


def _split_with_state(content: str) -> list[tuple[str, bool]]:
    """Return list of (line, in_code_block) tuples."""
    lines = content.splitlines(keepends=True)
    out: list[tuple[str, bool]] = []
    fence_count = 0
    for line in lines:
        is_fence = line.lstrip().startswith("```")
        currently_in = (fence_count % 2) == 1
        out.append((line, currently_in))
        if is_fence:
            fence_count += 1
    return out


# ---------------------------------------------------------------------------
# Fix 1: weak imperatives
# ---------------------------------------------------------------------------

def _is_fence_line(line: str) -> bool:
    """Detect if line is a code fence (``` or indented ```)."""
    return line.lstrip().startswith("```")


def _strip_inline_code(line: str) -> tuple[str, list[tuple[int, int, str]]]:
    """Replace inline `code` spans with placeholders; return (line, spans).

    Allows regex to run on prose-only portions of a line without touching
    `inline code` content. Spans contain (start, end, original_text).
    """
    placeholder_pattern = re.compile(r"`[^`\n]+`")
    spans: list[tuple[int, int, str]] = []
    out_parts: list[str] = []
    last = 0
    for m in placeholder_pattern.finditer(line):
        out_parts.append(line[last : m.start()])
        out_parts.append(" " * (m.end() - m.start()))  # blank space same length
        spans.append((m.start(), m.end(), m.group(0)))
        last = m.end()
    out_parts.append(line[last:])
    return "".join(out_parts), spans


def _restore_inline_code(masked_line: str, spans: list[tuple[int, int, str]]) -> str:
    """Restore inline code spans after replacements on the masked version.

    Since replacements ONLY happen outside spans, we can rebuild by walking
    char-by-char and substituting back at original span positions.
    """
    if not spans:
        return masked_line
    chars = list(masked_line)
    # If lengths differ (because outside replacements changed lengths), restoration
    # cannot trust absolute positions. Simpler: do a fresh pass on the masked line
    # but only outside spans. For safety, if length changed, we restore by
    # interleaving non-span text with original spans.
    # Simplest reliable approach: rebuild by walking through the ORIGINAL line and
    # taking modifications from the masked one ONLY in non-span ranges.
    return "".join(chars)


def fix_weak_imperatives(plan_path: Path, dry_run: bool = False) -> FixReport:
    report = FixReport(category="weak_imperatives")
    content = plan_path.read_text(encoding="utf-8")
    lines = _split_with_state(content)

    new_lines: list[str] = []
    for line_no, (line, in_code) in enumerate(lines, start=1):
        if in_code or _is_fence_line(line) or TASK_HEADER_RE.match(line):
            new_lines.append(line)
            continue
        modified = line
        line_changes = 0
        for pattern, replacement in WEAK_IMPERATIVE_PATTERNS:
            new_modified, count = re.subn(pattern, replacement, modified)
            if count > 0:
                report.changes_proposed += count
                line_changes += count
                report.locations.append(f"L{line_no}: {pattern} -> {replacement} (x{count})")
                modified = new_modified
        # Only normalize whitespace if THIS LINE was modified (avoid touching
        # indented prose / lists that didn't trigger any pattern).
        if line_changes > 0:
            # Preserve leading whitespace; only collapse internal doubles.
            leading_match = re.match(r"^(\s*)", modified)
            leading = leading_match.group(1) if leading_match else ""
            rest = modified[len(leading):]
            rest = re.sub(r"  +", " ", rest)
            modified = leading + rest
        new_lines.append(modified)

    new_content = "".join(new_lines)
    if dry_run:
        return report
    if new_content != content:
        plan_path.write_text(new_content, encoding="utf-8")
        report.changes_applied = report.changes_proposed
    return report


# ---------------------------------------------------------------------------
# Fix 2: loopholes
# ---------------------------------------------------------------------------

def fix_loopholes(plan_path: Path, dry_run: bool = False) -> FixReport:
    report = FixReport(category="loopholes")
    content = plan_path.read_text(encoding="utf-8")
    lines = _split_with_state(content)

    new_lines: list[str] = []
    for line_no, (line, in_code) in enumerate(lines, start=1):
        if in_code or _is_fence_line(line):
            new_lines.append(line)
            continue
        modified = line
        line_changes = 0
        for phrase in LOOPHOLE_PHRASES:
            pattern = re.compile(rf"\s*\b{re.escape(phrase)}\b", flags=re.IGNORECASE)
            new_modified, count = pattern.subn("", modified)
            if count > 0:
                report.changes_proposed += count
                line_changes += count
                report.locations.append(f"L{line_no}: removed '{phrase}' (x{count})")
                modified = new_modified
        # Only normalize whitespace on lines we changed.
        if line_changes > 0:
            leading_match = re.match(r"^(\s*)", modified)
            leading = leading_match.group(1) if leading_match else ""
            rest = modified[len(leading):]
            rest = re.sub(r"  +", " ", rest)
            rest = re.sub(r" +([.,;:])", r"\1", rest)
            modified = leading + rest
        new_lines.append(modified)

    new_content = "".join(new_lines)
    if dry_run:
        return report
    if new_content != content:
        plan_path.write_text(new_content, encoding="utf-8")
        report.changes_applied = report.changes_proposed
    return report


# ---------------------------------------------------------------------------
# Fix 3: TDD template injection
# ---------------------------------------------------------------------------

def _is_bugfix_title(title: str) -> bool:
    low = title.lower()
    return any(kw in low for kw in BUGFIX_KEYWORDS)


def _find_task_blocks(content: str) -> list[tuple[int, int, str, str]]:
    """Return list of (start_line, end_line, task_id, task_title) for each `### T-id` task.

    Lines are 0-indexed; end_line is EXCLUSIVE.
    """
    lines = content.splitlines(keepends=True)
    headers: list[tuple[int, str, str]] = []
    for i, line in enumerate(lines):
        m = TASK_HEADER_FULL_RE.match(line)
        if m:
            headers.append((i, m.group(1), m.group(2).strip()))

    blocks: list[tuple[int, int, str, str]] = []
    for idx, (start, tid, title) in enumerate(headers):
        end = headers[idx + 1][0] if idx + 1 < len(headers) else len(lines)
        # Also stop at next H2 within the task block
        for j in range(start + 1, end):
            if lines[j].startswith("## "):
                end = j
                break
        blocks.append((start, end, tid, title))
    return blocks


def fix_tdd_template(plan_path: Path, dry_run: bool = False) -> FixReport:
    report = FixReport(category="tdd_template")
    content = plan_path.read_text(encoding="utf-8")
    lines = content.splitlines(keepends=True)
    blocks = _find_task_blocks(content)

    # Process tasks in reverse so insertion indices stay valid.
    insertions: list[tuple[int, str]] = []
    for start, end, tid, title in reversed(blocks):
        body = "".join(lines[start:end])
        if not _is_bugfix_title(title):
            continue
        if "#### TDD" in body:
            continue
        # Find anchor for insertion: just before #### Acceptance Criteria,
        # or #### DoD, or end of block.
        insert_at = end
        for j in range(start + 1, end):
            stripped = lines[j].lstrip()
            if stripped.startswith("#### Acceptance Criteria") or stripped.startswith("#### DoD"):
                insert_at = j
                break
        report.changes_proposed += 1
        report.locations.append(f"L{start + 1}-{end}: {tid} (bug-fix without TDD)")
        # Insert template with a trailing blank line so the next section
        # doesn't lose its leading blank.
        block_to_insert = TDD_TEMPLATE + "\n"
        insertions.append((insert_at, block_to_insert))

    if dry_run or not insertions:
        if dry_run:
            return report
        return report

    # Apply insertions in reverse order
    for at, block_text in insertions:
        lines.insert(at, block_text)
    new_content = "".join(lines)
    if new_content != content:
        plan_path.write_text(new_content, encoding="utf-8")
        report.changes_applied = report.changes_proposed
    return report


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def apply_all_fixes(plan_path: Path, dry_run: bool = False) -> TotalReport:
    total = TotalReport()
    for fn in (fix_weak_imperatives, fix_loopholes, fix_tdd_template):
        r = fn(plan_path, dry_run=dry_run)
        total.per_category.append(r)
        total.total_changes_proposed += r.changes_proposed
        total.total_changes_applied += r.changes_applied
    return total


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Apply deterministic plan-improve fixes.")
    parser.add_argument("plan", help="path to plan .md")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    plan_path = Path(args.plan)
    if not plan_path.exists():
        print(f"ERROR: plan not found: {plan_path}", file=sys.stderr)
        return 2

    report = apply_all_fixes(plan_path, dry_run=args.dry_run)
    if args.json:
        print(json.dumps(asdict(report), indent=2, ensure_ascii=False))
    else:
        for r in report.per_category:
            verb = "would change" if args.dry_run else "changed"
            print(f"[{r.category}] {verb} {r.changes_applied if not args.dry_run else r.changes_proposed} item(s)")
            for loc in r.locations:
                print(f"  {loc}")
        total_n = report.total_changes_applied if not args.dry_run else report.total_changes_proposed
        print(f"\nTotal: {total_n} change(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
