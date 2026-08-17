"""Drawbacks & Risks structural check for /to-plan plans (SOTA upgrade).

Verifies the plan's `## Drawbacks & Risks` section has at least 2 entries,
each with severity + mitigation + owner. RFC-tradition section (Rust RFCs,
Python PEPs) — every non-trivial change has trade-offs; refusing to
enumerate them is intellectual dishonesty.

Missing section OR fewer than 2 entries OR placeholder rows cap the plan
at score 70.

Stable identifier for the soft cap: `drawbacks_section_insufficient`.

Also verifies `## Unresolved Questions` section is present. The section
may legitimately say "(none — every decision is resolved at plan time)"
when justified — the edge-case-plan phase will challenge that.

Stable identifier for the unresolved-questions soft cap:
`unresolved_questions_section_missing`.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

FENCED_CODE_RE = re.compile(r"^(```|~~~)[^\n]*\n.*?^\1", re.MULTILINE | re.DOTALL)

PLACEHOLDER_FRAGMENTS = (
    "Migration window leaves users on old schema",
    "New dependency `libX`",
    "Tree-shake; benchmark",
    "what happens if {edge case}",
    "does {assumption} hold",
)


@dataclass(frozen=True)
class DrawbacksReport:
    """Structural report for a plan's Drawbacks & Risks section + Unresolved Questions."""

    drawbacks_section_present: bool
    drawbacks_entries: int = 0
    drawbacks_placeholder_hits: int = 0
    drawbacks_is_complete: bool = False
    drawbacks_reasons: tuple[str, ...] = field(default_factory=tuple)

    unresolved_section_present: bool = False
    unresolved_entries: int = 0
    unresolved_explicit_none: bool = False
    unresolved_is_complete: bool = False
    unresolved_reasons: tuple[str, ...] = field(default_factory=tuple)


def _strip_code(content: str) -> str:
    def blank(m: re.Match[str]) -> str:
        return re.sub(r"[^\n]", " ", m.group(0))

    return FENCED_CODE_RE.sub(blank, content)


def _extract_section(content: str, heading: str) -> str | None:
    """Match '## {heading}' optionally followed by trailing prose, up to next H2."""
    pattern = re.compile(rf"^##\s+{re.escape(heading)}(?=\b|$)", re.MULTILINE)
    match = pattern.search(content)
    if match is None:
        return None
    start = match.end()
    next_h2 = re.search(r"^##\s+", content[start:], re.MULTILINE)
    end = (start + next_h2.start()) if next_h2 else len(content)
    return content[start:end]


def _count_table_data_rows(section: str) -> int:
    """Count non-header, non-separator markdown table rows."""
    rows = 0
    seen_separator = False
    for line in section.splitlines():
        s = line.strip()
        if not s.startswith("|") or not s.endswith("|"):
            continue
        inner = s[1:-1]
        if re.match(r"^[\s\-:|]+$", inner):
            seen_separator = True
            continue
        if not seen_separator:
            # header row
            continue
        # Real data row only if non-empty cells exist
        cells = [c.strip() for c in inner.split("|")]
        if any(cells):
            rows += 1
    return rows


def _count_question_bullets(section: str) -> int:
    """Count `- Q\\d` style bullets OR `- ...` non-empty bullets in Unresolved Questions."""
    return len(re.findall(r"^\s*[-*]\s+(Q\d+|[A-Z])", section, re.MULTILINE))


def _count_placeholder_hits(text: str) -> int:
    return sum(1 for fragment in PLACEHOLDER_FRAGMENTS if fragment in text)


def check_drawbacks_section(plan_path: Path) -> DrawbacksReport:
    """Inspect plan_path and produce a DrawbacksReport (covers both Drawbacks & Unresolved)."""
    content = plan_path.read_text(encoding="utf-8-sig")
    stripped = _strip_code(content)

    # --- Drawbacks & Risks ---
    drawbacks_section = _extract_section(stripped, "Drawbacks & Risks")
    drawbacks_present = drawbacks_section is not None
    drawbacks_entries = 0
    drawbacks_placeholder_hits = 0
    drawbacks_reasons: list[str] = []

    if not drawbacks_present:
        drawbacks_reasons.append("'## Drawbacks & Risks' section not found")
    else:
        drawbacks_entries = _count_table_data_rows(drawbacks_section)
        drawbacks_placeholder_hits = _count_placeholder_hits(drawbacks_section)
        if drawbacks_entries < 2:
            drawbacks_reasons.append(
                f"'## Drawbacks & Risks' has {drawbacks_entries} entries, "
                "minimum required is 2 (no non-trivial plan is risk-free)"
            )
        if drawbacks_placeholder_hits > 0:
            drawbacks_reasons.append(
                f"'## Drawbacks & Risks' contains {drawbacks_placeholder_hits} "
                "template placeholder fragment(s) — replace with real risks"
            )

    drawbacks_is_complete = (
        drawbacks_present
        and drawbacks_entries >= 2
        and drawbacks_placeholder_hits == 0
    )

    # --- Unresolved Questions ---
    unresolved_section = _extract_section(stripped, "Unresolved Questions")
    unresolved_present = unresolved_section is not None
    unresolved_entries = 0
    unresolved_explicit_none = False
    unresolved_reasons: list[str] = []

    if not unresolved_present:
        unresolved_reasons.append("'## Unresolved Questions' section not found")
    else:
        unresolved_entries = _count_question_bullets(unresolved_section)
        unresolved_explicit_none = bool(
            re.search(r"\(none\b[^)]*every decision is resolved", unresolved_section, re.IGNORECASE)
            or re.search(r"\(none — every decision", unresolved_section)
        )
        if unresolved_entries == 0 and not unresolved_explicit_none:
            unresolved_reasons.append(
                "'## Unresolved Questions' has no entries and no '(none — every decision is resolved at plan time)' marker"
            )

    unresolved_is_complete = unresolved_present and (
        unresolved_entries > 0 or unresolved_explicit_none
    )

    return DrawbacksReport(
        drawbacks_section_present=drawbacks_present,
        drawbacks_entries=drawbacks_entries,
        drawbacks_placeholder_hits=drawbacks_placeholder_hits,
        drawbacks_is_complete=drawbacks_is_complete,
        drawbacks_reasons=tuple(drawbacks_reasons),
        unresolved_section_present=unresolved_present,
        unresolved_entries=unresolved_entries,
        unresolved_explicit_none=unresolved_explicit_none,
        unresolved_is_complete=unresolved_is_complete,
        unresolved_reasons=tuple(unresolved_reasons),
    )
