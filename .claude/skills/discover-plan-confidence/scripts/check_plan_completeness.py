"""Plan-completeness checker for /discover-plan discovery plans (M2 deterministic).

Bundles 4 sub-checks for orchestrator simplicity:

  1. mandatory_sections — all 10 required headers present (caps verdict at 70 if any missing)
  2. question_budget   — 5 <= N <= 10, per-corner <= 3, per-corner >= 1 OR DEFER-CORNER marker per D5
  3. method_per_question — Fase A non-empty OR 'SKIP' AND Fase B non-empty (header-text-based per EC-2)
  4. adr_count         — at least 2 ADRs in ## ADRs section (D1 time-budget + D2 investigation-depth minimum)

Returns one combined report dict; the orchestrator decides which hard caps fire
based on which keys are populated:
  - missing_mandatory non-empty   -> mandatory_section_missing cap (70)
  - adr_count < 2                 -> insufficient_adrs cap (70)
  - budget_violations non-empty   -> question_budget_violated cap (70)
  - methodless_questions non-empty-> method_missing cap (70)
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from check_research_coverage import _has_defer_corner_marker


CORNERS = ("tests", "deps", "tools", "techniques")
MIN_QUESTIONS = 5
MAX_QUESTIONS = 10
MAX_PER_CORNER = 3
MIN_ADRS = 2

MANDATORY_SECTIONS = [
    ("Header", r"^#\s+Discovery\s+Plan:"),
    ("Context", r"^##\s+Context"),
    ("Objective", r"^##\s+Objective"),
    ("In-Scope", r"^##\s+In[- ]Scope"),
    ("ADRs", r"^##\s+ADRs"),
    ("Research Questions", r"^##\s+Research\s+Questions"),
    ("Coverage Matrix", r"^##\s+Coverage\s+Matrix"),
    ("Halt-loop Checkpoints", r"^##\s+Halt[- ]loop\s+Checkpoints"),
    ("Acceptance Criteria", r"^##\s+Acceptance\s+Criteria"),
    ("Global Definition of Done", r"^##\s+Global\s+Definition\s+of\s+Done"),
]

ADR_HEADER_RE = re.compile(r"^###\s+D\d+\s*(?:—|-)", re.MULTILINE)
ADRS_SECTION_RE = re.compile(r"^##\s+ADRs\b", re.MULTILINE | re.IGNORECASE)
QUESTIONS_HEADER_RE = re.compile(r"^##\s+Research\s+Questions\s*$", re.MULTILINE | re.IGNORECASE)
NEXT_H2_RE = re.compile(r"^##\s+\S", re.MULTILINE)
TABLE_ROW_RE = re.compile(r"^\|.*\|\s*$", re.MULTILINE)
QID_RE = re.compile(r"^Q\d+$")
FASE_A_HEADER_RE = re.compile(r"^\s*Fase\s*A\b", re.IGNORECASE)
FASE_B_HEADER_RE = re.compile(r"^\s*Fase\s*B\b", re.IGNORECASE)


def _check_mandatory_sections(content: str) -> tuple[list[str], list[str]]:
    """Returns (present_names, missing_names) by regex-matching each header pattern."""
    present: list[str] = []
    missing: list[str] = []
    for name, pattern in MANDATORY_SECTIONS:
        if re.search(pattern, content, re.MULTILINE | re.IGNORECASE):
            present.append(name)
        else:
            missing.append(name)
    return present, missing


def _extract_questions_section(content: str) -> str:
    header = QUESTIONS_HEADER_RE.search(content)
    if not header:
        return ""
    start = header.end()
    next_h2 = NEXT_H2_RE.search(content, pos=start)
    end = next_h2.start() if next_h2 else len(content)
    return content[start:end]


def _split_row(row: str) -> list[str]:
    return [p.strip() for p in row.split("|")]


def _find_method_column_indices(questions_section: str) -> tuple[int | None, int | None]:
    """Find col indices of 'Fase A' and 'Fase B' by HEADER TEXT match (per EC-2).

    Returns (idx_a, idx_b). Either may be None if not found (header renamed).
    The header row is the first table row that contains 'Fase' in any cell.
    """
    for row_match in TABLE_ROW_RE.finditer(questions_section):
        row = row_match.group(0)
        cells = _split_row(row)
        if not any("fase" in c.lower() for c in cells):
            continue
        idx_a = next((i for i, c in enumerate(cells) if FASE_A_HEADER_RE.match(c)), None)
        idx_b = next((i for i, c in enumerate(cells) if FASE_B_HEADER_RE.match(c)), None)
        return idx_a, idx_b
    return None, None


def _parse_question_rows(questions_section: str) -> list[dict[str, Any]]:
    """Return rows where col-1 matches Q\\d+, each with corner + raw cells."""
    rows: list[dict[str, Any]] = []
    for row_match in TABLE_ROW_RE.finditer(questions_section):
        row = row_match.group(0)
        cells = _split_row(row)
        if len(cells) < 4:
            continue
        first = cells[1] if len(cells) > 1 else ""
        if not QID_RE.match(first):
            continue
        corner = cells[3].strip().strip("`").lower() if len(cells) > 3 else ""
        rows.append({"q_id": first, "corner": corner, "cells": cells})
    return rows


def _check_question_budget(
    content: str, q_rows: list[dict[str, Any]]
) -> list[str]:
    """Returns list of violation identifiers. Empty list = no violations."""
    violations: list[str] = []
    total = len(q_rows)
    if total < MIN_QUESTIONS:
        violations.append(f"too_few_questions ({total} < {MIN_QUESTIONS})")
    if total > MAX_QUESTIONS:
        violations.append(f"too_many_questions ({total} > {MAX_QUESTIONS})")

    counts: dict[str, int] = {c: 0 for c in CORNERS}
    for row in q_rows:
        if row["corner"] in counts:
            counts[row["corner"]] += 1

    for corner, n in counts.items():
        if n > MAX_PER_CORNER:
            violations.append(f"corner_overflow_{corner} ({n} > {MAX_PER_CORNER})")
        elif n == 0 and not _has_defer_corner_marker(content, corner):
            violations.append(f"corner_uncovered_{corner}")
    return violations


def _check_methods(q_rows: list[dict[str, Any]], idx_a: int | None, idx_b: int | None) -> list[str]:
    """Returns list of Q-IDs with method violations.

    Per EC-2: columns located by HEADER TEXT (idx_a, idx_b passed in).
    Rule: Fase A must be non-empty (the literal token 'SKIP' is the text-shape exemption
    and is itself non-empty, so the same check covers both cases). Fase B must be non-empty.
    If header row contained neither 'Fase A' nor 'Fase B', emit '__header_not_found__'.
    """
    if idx_a is None and idx_b is None:
        return ["__header_not_found__"]

    violations: list[str] = []
    for row in q_rows:
        cells = row["cells"]
        fase_a = cells[idx_a].strip() if idx_a is not None and idx_a < len(cells) else ""
        fase_b = cells[idx_b].strip() if idx_b is not None and idx_b < len(cells) else ""
        if fase_a == "" or fase_b == "":
            violations.append(row["q_id"])
    return violations


def _count_adrs(content: str) -> int:
    """Count `### D\\d+ —` headers within the ## ADRs section body."""
    adrs_match = ADRS_SECTION_RE.search(content)
    if not adrs_match:
        return 0
    start = adrs_match.end()
    next_h2 = NEXT_H2_RE.search(content, pos=start)
    body = content[start : next_h2.start()] if next_h2 else content[start:]
    return len(ADR_HEADER_RE.findall(body))


def check_plan_completeness(plan_path: Path) -> dict[str, Any]:
    content = plan_path.read_text(encoding="utf-8-sig")

    present, missing = _check_mandatory_sections(content)
    q_section = _extract_questions_section(content)
    idx_a, idx_b = _find_method_column_indices(q_section)
    q_rows = _parse_question_rows(q_section)
    budget_violations = _check_question_budget(content, q_rows)
    methodless = _check_methods(q_rows, idx_a, idx_b)
    adr_count = _count_adrs(content)

    contributors: list[str] = [f"{len(present)}/{len(MANDATORY_SECTIONS)} mandatory sections present"]
    if adr_count >= MIN_ADRS:
        contributors.append(f"{adr_count} ADRs found")
    if not budget_violations:
        contributors.append(f"Question budget OK ({len(q_rows)} Qs)")
    if not methodless:
        contributors.append("Every Q has Fase A + Fase B populated")

    detractors: list[str] = []
    for m in missing[:3]:
        detractors.append(f"Missing section: {m}")
    if adr_count < MIN_ADRS:
        detractors.append(f"Only {adr_count} ADRs found (need {MIN_ADRS}+)")
    detractors.extend(f"Budget: {v}" for v in budget_violations[:3])
    if methodless:
        detractors.append(f"Methodless Qs: {methodless[:3]}")

    return {
        "total_required": len(MANDATORY_SECTIONS),
        "found": len(present),
        "present": present,
        "missing_mandatory": missing,
        "adr_count": adr_count,
        "budget_violations": budget_violations,
        "methodless_questions": methodless,
        "contributors": contributors[:3],
        "detractors": detractors[:3],
    }
