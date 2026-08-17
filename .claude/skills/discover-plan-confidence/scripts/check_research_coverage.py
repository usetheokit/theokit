"""Research-coverage checker for /discover-plan discovery plans (M2 deterministic).

Verifies that all 4 coverage corners (tests, deps, tools, techniques) are
populated EITHER by at least one Research Question OR by an explicit
DEFER-CORNER marker per D5 of the discover-plan-confidence plan.

An empty corner (no Q mapped AND no DEFER-CORNER marker) triggers an
empty_corner_{name} hard cap (=49) in the orchestrator.

Sibling of .claude/skills/discover-confidence/scripts/check_research_coverage.py
but adapted for plans: inspects the Research Questions + Coverage Matrix
TABLES rather than blueprint sections.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any


CORNERS = ("tests", "deps", "tools", "techniques")

QUESTIONS_HEADER_RE = re.compile(r"^##\s+Research\s+Questions\s*$", re.MULTILINE | re.IGNORECASE)
NEXT_H2_RE = re.compile(r"^##\s+\S", re.MULTILINE)
TABLE_ROW_RE = re.compile(r"^\|.*\|\s*$", re.MULTILINE)
QID_RE = re.compile(r"^Q\d+$")
DEFER_CORNER_RE = re.compile(
    r"<!--\s*DEFER-CORNER:\s*(tests|deps|tools|techniques)\b",
    re.IGNORECASE | re.DOTALL,
)
TBD_MARKER_RE = re.compile(r"<!--\s*TBD\b", re.IGNORECASE)


def _has_defer_corner_marker(content: str, corner: str) -> bool:
    """True iff a `<!-- DEFER-CORNER: {corner} | ... -->` marker exists anywhere in content."""
    for match in DEFER_CORNER_RE.finditer(content):
        if match.group(1).lower() == corner:
            return True
    return False


def _extract_questions_section(content: str) -> str:
    """Return the body of the `## Research Questions` H2 (header excluded)."""
    header_match = QUESTIONS_HEADER_RE.search(content)
    if not header_match:
        return ""
    start = header_match.end()
    next_h2 = NEXT_H2_RE.search(content, pos=start)
    end = next_h2.start() if next_h2 else len(content)
    return content[start:end]


def _parse_corner(cell: str) -> str:
    """Normalize a Corner cell (strip whitespace + backticks + dashes)."""
    return cell.strip().strip("`").lower()


def _count_questions_per_corner(questions_section: str) -> dict[str, int]:
    """Walk table rows; for each Q-row, increment counter for its corner cell."""
    counts: dict[str, int] = {c: 0 for c in CORNERS}
    for row_match in TABLE_ROW_RE.finditer(questions_section):
        row = row_match.group(0)
        parts = [p.strip() for p in row.split("|")]
        if len(parts) < 4:
            continue
        first_col = parts[1] if len(parts) > 1 else ""
        if not QID_RE.match(first_col):
            continue
        corner = _parse_corner(parts[3]) if len(parts) > 3 else ""
        if corner in counts:
            counts[corner] += 1
    return counts


def check_research_coverage(plan_path: Path) -> dict[str, Any]:
    content = plan_path.read_text(encoding="utf-8-sig")
    questions_section = _extract_questions_section(content)
    counts = _count_questions_per_corner(questions_section)

    corners_status: list[dict[str, Any]] = []
    empty_corners: list[str] = []
    populated_count = 0

    for corner in CORNERS:
        has_questions = counts[corner] > 0
        has_defer = _has_defer_corner_marker(content, corner)
        populated = has_questions or has_defer
        corners_status.append(
            {
                "corner": corner,
                "present": has_questions or has_defer,
                "populated": populated,
                "question_count": counts[corner],
                "deferred": has_defer and not has_questions,
            }
        )
        if populated:
            populated_count += 1
        else:
            empty_corners.append(corner)

    contributors = [
        f"Corner '{c['corner']}' populated ({c['question_count']} Q{'s' if c['question_count'] != 1 else ''}"
        + (", DEFER-CORNER marker" if c["deferred"] else "")
        + ")"
        for c in corners_status
        if c["populated"]
    ][:3]
    detractors = [
        f"Corner '{c['corner']}' empty (no Q mapped, no DEFER-CORNER marker)"
        for c in corners_status
        if not c["populated"]
    ][:3]

    return {
        "corners_populated": populated_count,
        "corners_total": 4,
        "corners_status": corners_status,
        "empty_corners": empty_corners,
        "contributors": contributors,
        "detractors": detractors,
    }
