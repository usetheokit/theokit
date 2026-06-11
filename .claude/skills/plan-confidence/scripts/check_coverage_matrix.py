"""Coverage Matrix structural check for /to-plan plans (M2 deterministic).

Parses a plan .md file, extracts the `## Coverage Matrix` section,
counts mapped gaps and detects orphan task references in the body.

v1.1 EC-4 fix: orphan detection EXCLUDES task definition headers
(lines matching `^###\\s+T\\d+\\.\\d+`) — otherwise every task header
would be counted as a "mention" and produce false orphans.

v1.1 EC-8 fix: uses `encoding='utf-8-sig'` to tolerate UTF-8 BOM.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

TASK_ID_RE = re.compile(r"T\d+\.\d+")
TASK_HEADER_RE = re.compile(r"^###\s+T\d+\.\d+", re.MULTILINE)
COVERAGE_HEADER_RE = re.compile(r"^##\s+Coverage Matrix\s*$", re.MULTILINE)
NEXT_H2_RE = re.compile(r"^##\s+", re.MULTILINE)
FENCED_CODE_RE = re.compile(r"^```[^\n]*\n.*?^```", re.MULTILINE | re.DOTALL)
INLINE_CODE_RE = re.compile(r"`[^`\n]+`")


OUT_OF_SCOPE_PATTERNS = (
    "out-of-scope",
    "out of scope",
    "deferred",
    "n/a — d",  # "N/A — D9" pattern
    "n/a -- d",
    "(d",  # "(out-of-scope D9)" or "(D9)" — caught after substring "out-of-scope"
)


def _is_out_of_scope_marker(task_col: str) -> bool:
    """Detect whether a row's task column signals deliberate deferral.

    v1.1+ #2 fix: 'N/A — D9 out-of-scope', '(out-of-scope D5)', 'DEFERRED to v2'
    etc. are not 'missed' gaps; they are explicit deferrals.
    """
    col_lower = task_col.lower()
    return any(pattern in col_lower for pattern in OUT_OF_SCOPE_PATTERNS)


@dataclass(frozen=True)
class CoverageReport:
    """Structural report for a plan's Coverage Matrix."""

    total_gaps: int
    total_tasks_referenced: int
    mapped_gaps: int
    deferred_gaps: int = 0  # v1.1+ #2 fix: explicitly out-of-scope, not missed
    unmapped_gaps: tuple[str, ...] = field(default_factory=tuple)
    orphan_tasks: tuple[str, ...] = field(default_factory=tuple)
    coverage_ratio: float = 0.0
    is_complete: bool = False
    parse_errors: tuple[str, ...] = field(default_factory=tuple)


def _read_plan(plan_path: Path) -> str:
    """Read plan with UTF-8 BOM tolerance (EC-8 fix)."""
    if not plan_path.exists():
        raise FileNotFoundError(f"Plan file not found: {plan_path}")
    # utf-8-sig auto-strips BOM if present.
    return plan_path.read_text(encoding="utf-8-sig")


def _extract_coverage_section(content: str) -> str:
    """Extract text between '## Coverage Matrix' and next H2."""
    header_match = COVERAGE_HEADER_RE.search(content)
    if header_match is None:
        raise ValueError("No '## Coverage Matrix' section found in plan")
    start = header_match.end()
    # Find next H2 after our header
    next_h2 = NEXT_H2_RE.search(content, pos=start)
    end = next_h2.start() if next_h2 else len(content)
    return content[start:end]


def _is_data_row(stripped: str) -> bool:
    """Validate row starts/ends with | and isn't a separator."""
    if not stripped.startswith("|") or not stripped.endswith("|"):
        return False
    inner = stripped[1:-1]
    return not bool(re.match(r"^[\s\-:|]+$", inner))


def _pick_task_column(cells: list[str]) -> str:
    """Priority order for selecting which cell is 'task column' in flexible-width rows.

    1) First cell containing T-id pattern → real task ref.
    2) First cell with out-of-scope marker → deferral signal.
    3) First cell empty / dash / 'N/A' → unmapped signal.
    4) Fallback to cells[2].
    """
    for cell in cells[2:]:
        if TASK_ID_RE.search(cell):
            return cell
    for cell in cells[2:]:
        if _is_out_of_scope_marker(cell):
            return cell
    for cell in cells[2:]:
        if cell.lower().strip() in ("", "—", "-", "n/a"):
            return cell
    return cells[2]


def _parse_matrix_rows(section: str) -> list[tuple[str, str, str]]:
    """Parse table rows. Returns list of (gap_id, gap_desc, task_col).

    Real plans use varying column counts (e.g., adding 'Severidade', 'Status').
    Flexible-width: scan all cells from index 2 for the task column.
    """
    rows: list[tuple[str, str, str]] = []
    for line in section.splitlines():
        stripped = line.strip()
        if not _is_data_row(stripped):
            continue
        cells = [c.strip() for c in stripped[1:-1].split("|")]
        if len(cells) < 4 or cells[0].strip() == "#":
            continue
        rows.append((cells[0], cells[1], _pick_task_column(cells)))
    return rows


def _strip_code(content: str) -> str:
    """Remove fenced code blocks and inline code so they don't pollute prose scans.

    v1.1 EC-9 follow-up: task IDs and smells inside ```code``` or `inline` are
    examples/documentation, not real references. Replace with whitespace to
    preserve line numbers (important for downstream line-aware reports).
    """
    # Replace each block with whitespace of equal length (preserve newlines).
    def blank_keeping_lines(m: re.Match[str]) -> str:
        return re.sub(r"[^\n]", " ", m.group(0))

    no_fenced = FENCED_CODE_RE.sub(blank_keeping_lines, content)
    no_inline = INLINE_CODE_RE.sub(blank_keeping_lines, no_fenced)
    return no_inline


def _find_orphan_references(content: str, matrix_task_ids: set[str]) -> list[str]:
    """Find T{N}.{M} references in body that are TRULY orphan.

    A task ID is orphan iff:
      1. It is mentioned in PROSE (excluding fenced code blocks).
      2. It is NOT in the Coverage Matrix.
      3. It does NOT have a '### T{N}.{M}' header definition somewhere in the plan.

    v1.1 EC-4 fix: headers like '### T1.1 — Title' are definitions, not references.
    v1.1 EC-9 follow-up: code blocks contain examples (test names), not real refs.
    v1.1+ relaxation: tasks defined as `### T-id` headers are LEGITIMATE plan tasks
    even if not in the matrix (e.g., wrap-up/dogfood-phase tasks). Only "mentions
    in prose with no definition" are true orphans (typos, refs to non-existent tasks).
    """
    prose_only = _strip_code(content)

    defined_ids: set[str] = set()
    header_lines: set[int] = set()
    for match in TASK_HEADER_RE.finditer(content):
        line_no = content[: match.start()].count("\n")
        header_lines.add(line_no)
        # Extract the T-id from the header line for the defined set.
        header_line_text = content.splitlines()[line_no]
        for tid_match in TASK_ID_RE.finditer(header_line_text):
            defined_ids.add(tid_match.group(0))

    mentions: set[str] = set()
    for line_no, line in enumerate(prose_only.splitlines()):
        if line_no in header_lines:
            continue
        for match in TASK_ID_RE.finditer(line):
            mentions.add(match.group(0))

    # Orphans = mentioned in prose, NOT in matrix, NOT defined as header.
    return sorted(mentions - matrix_task_ids - defined_ids)


def check_coverage_matrix(plan_path: Path) -> CoverageReport:
    """Parse plan and produce a CoverageReport.

    Raises:
        FileNotFoundError: if plan_path doesn't exist.
        ValueError: if no '## Coverage Matrix' section is found.
    """
    content = _read_plan(plan_path)
    section = _extract_coverage_section(content)
    rows = _parse_matrix_rows(section)

    total_gaps = len(rows)
    mapped_gaps = 0
    deferred_gaps = 0
    unmapped: list[str] = []
    matrix_task_ids: set[str] = set()

    for gap_id, gap_desc, task_col in rows:
        task_refs = TASK_ID_RE.findall(task_col)
        if task_refs:
            mapped_gaps += 1
            matrix_task_ids.update(task_refs)
        elif _is_out_of_scope_marker(task_col):
            # v1.1+ #2 fix: explicit deferral, not a miss
            deferred_gaps += 1
        else:
            unmapped.append(f"#{gap_id}: {gap_desc}")

    orphans = _find_orphan_references(content, matrix_task_ids)

    # Effective coverage = (mapped + deferred) / total
    effective_covered = mapped_gaps + deferred_gaps
    coverage_ratio = (
        (1.0 if not orphans else 0.0)
        if total_gaps == 0
        else effective_covered / total_gaps
    )

    is_complete = coverage_ratio >= 1.0 and not orphans

    return CoverageReport(
        total_gaps=total_gaps,
        total_tasks_referenced=len(matrix_task_ids),
        mapped_gaps=mapped_gaps,
        deferred_gaps=deferred_gaps,
        unmapped_gaps=tuple(unmapped),
        orphan_tasks=tuple(orphans),
        coverage_ratio=coverage_ratio,
        is_complete=is_complete,
        parse_errors=(),
    )
