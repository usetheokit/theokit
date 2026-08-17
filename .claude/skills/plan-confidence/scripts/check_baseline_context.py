"""Baseline Context structural check for /to-plan plans (SOTA upgrade).

Verifies the plan's `## Baseline Context` section is present and populated
from real evidence (not placeholders). The section is the "deep review of
current state" that lets a junior implement the plan without spelunking
the repo.

A plan is acceptable for SHIPPABLE only when the Baseline Context section
contains all four required subsections AND each subsection has real data
(not the template's example rows). Missing or placeholder section caps
the plan at score 70 (SHIPPABLE_WITH_CAVEATS at best).

Required structure (per `skills/to-plan/templates/plan-template.md`):

    ## Baseline Context
    ### Files that will be touched
    | File | LoC today | Last commit ... | Why ... | Invariants ... |
    | <real-file>.<ext> | <number> | <sha> ... | ... | ... |
    ...
    ### Current callers / dependents
    - **Symbol:** ...
    - **Callers (production):** ...
    ...
    ### Domain glossary
    - **<term>** — definition
    ...
    ### Architecture boundaries affected
    ...

Stable identifier for the soft cap: `baseline_context_incomplete`.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

H2_RE = re.compile(r"^##\s+(.*?)\s*$", re.MULTILINE)
H3_RE = re.compile(r"^###\s+(.*?)\s*$", re.MULTILINE)
TABLE_ROW_RE = re.compile(r"^\|[^|\n]+(?:\|[^|\n]*)+\|\s*$", re.MULTILINE)
FENCED_CODE_RE = re.compile(r"^(```|~~~)[^\n]*\n.*?^\1", re.MULTILINE | re.DOTALL)

# Template example fragments — if any of these appears verbatim in the plan,
# the section is not yet populated with real data. Kept conservative so a real
# plan with unusual but legitimate phrasing does not false-positive.
PLACEHOLDER_FRAGMENTS = (
    "src/path/to/file.ext",
    "src/path/to/other.ext",
    "abc1234",   # template SHA placeholder; real SHAs collide with probability ~1/16^7
    "def5678",
    "<term-1>",
    "<term-2>",
    "<symbol-1>",
)

REQUIRED_SUBSECTIONS = (
    "Files that will be touched",
    "Current callers / dependents",
    "Domain glossary",
    "Architecture boundaries affected",
)


@dataclass(frozen=True)
class BaselineContextReport:
    """Structural report for a plan's Baseline Context section."""

    section_present: bool
    missing_subsections: tuple[str, ...] = field(default_factory=tuple)
    file_table_rows: int = 0
    file_table_placeholder_hits: int = 0
    glossary_entries: int = 0
    glossary_placeholder_hits: int = 0
    is_complete: bool = False
    reasons: tuple[str, ...] = field(default_factory=tuple)


def _strip_code(content: str) -> str:
    """Remove fenced code blocks so example placeholders inside docs do not pollute scans."""

    def blank(m: re.Match[str]) -> str:
        return re.sub(r"[^\n]", " ", m.group(0))

    return FENCED_CODE_RE.sub(blank, content)


def _extract_section(content: str, heading: str) -> str | None:
    """Return text between '## {heading}' (possibly with trailing text) and the next H2, or None if absent.

    Tolerates parenthetical or trailing prose after the heading, e.g.
    '## Baseline Context (deep review of current state)'. Matches end-of-word
    after the heading via lookahead so 'Baseline Context' does NOT match
    'Baseline Contexts' or 'Baseline Contextual'.
    """
    pattern = re.compile(rf"^##\s+{re.escape(heading)}(?=\b|$)", re.MULTILINE)
    match = pattern.search(content)
    if match is None:
        return None
    start = match.end()
    next_h2 = re.search(r"^##\s+", content[start:], re.MULTILINE)
    end = (start + next_h2.start()) if next_h2 else len(content)
    return content[start:end]


def _extract_subsection(section: str, h3_title: str) -> str | None:
    """Return text between '### {h3_title}' (possibly with trailing text) and the next H2 or H3."""
    pattern = re.compile(rf"^###\s+{re.escape(h3_title)}(?=\b|$)", re.MULTILINE)
    match = pattern.search(section)
    if match is None:
        return None
    start = match.end()
    next_break = re.search(r"^(##|###)\s+", section[start:], re.MULTILINE)
    end = (start + next_break.start()) if next_break else len(section)
    return section[start:end]


def _data_rows(table_text: str) -> list[list[str]]:
    """Parse markdown table data rows (excluding header + separator).

    A data row starts/ends with `|` and is not a separator (contains only -, :, |, whitespace).
    The first two `|`-delimited rows are header + separator (skipped).
    """
    rows: list[list[str]] = []
    raw_rows: list[str] = []
    for line in table_text.splitlines():
        s = line.strip()
        if not s.startswith("|") or not s.endswith("|"):
            continue
        inner = s[1:-1]
        if re.match(r"^[\s\-:|]+$", inner):
            # separator row
            raw_rows.append(s)
            continue
        raw_rows.append(s)
    # Drop the header row (first non-separator) — by convention markdown tables
    # have header / separator / data rows in order.
    seen_separator = False
    for s in raw_rows:
        inner = s[1:-1]
        if re.match(r"^[\s\-:|]+$", inner):
            seen_separator = True
            continue
        if not seen_separator:
            # header row before any separator → skip
            continue
        cells = [c.strip() for c in inner.split("|")]
        rows.append(cells)
    return rows


def _count_placeholder_hits(text: str) -> int:
    hits = 0
    for fragment in PLACEHOLDER_FRAGMENTS:
        if fragment in text:
            hits += 1
    return hits


def _count_glossary_entries(text: str) -> int:
    # Markdown bullets of the form: - **term** — definition
    return len(re.findall(r"^\s*[-*]\s+\*\*[^*]+\*\*\s+[—–-]\s+\S", text, re.MULTILINE))


def check_baseline_context(plan_path: Path) -> BaselineContextReport:
    """Inspect plan_path and produce a BaselineContextReport."""
    content = plan_path.read_text(encoding="utf-8-sig")
    stripped = _strip_code(content)

    section = _extract_section(stripped, "Baseline Context")
    if section is None:
        return BaselineContextReport(
            section_present=False,
            missing_subsections=REQUIRED_SUBSECTIONS,
            is_complete=False,
            reasons=("'## Baseline Context' section not found",),
        )

    missing: list[str] = []
    reasons: list[str] = []

    files_sub = _extract_subsection(section, "Files that will be touched")
    callers_sub = _extract_subsection(section, "Current callers / dependents")
    glossary_sub = _extract_subsection(section, "Domain glossary")
    arch_sub = _extract_subsection(section, "Architecture boundaries affected")

    for title, sub in (
        ("Files that will be touched", files_sub),
        ("Current callers / dependents", callers_sub),
        ("Domain glossary", glossary_sub),
        ("Architecture boundaries affected", arch_sub),
    ):
        if sub is None:
            missing.append(title)
            reasons.append(f"subsection '### {title}' missing")

    file_table_rows = 0
    file_table_placeholder_hits = 0
    if files_sub is not None:
        rows = _data_rows(files_sub)
        file_table_rows = len(rows)
        file_table_placeholder_hits = _count_placeholder_hits(files_sub)
        if file_table_rows == 0:
            reasons.append("'### Files that will be touched' table has no data rows")
        if file_table_placeholder_hits > 0:
            reasons.append(
                f"'### Files that will be touched' contains {file_table_placeholder_hits} "
                "template placeholder fragment(s) — populate with real evidence"
            )

    glossary_entries = 0
    glossary_placeholder_hits = 0
    if glossary_sub is not None:
        glossary_entries = _count_glossary_entries(glossary_sub)
        glossary_placeholder_hits = _count_placeholder_hits(glossary_sub)
        # "(none)" is acceptable per template — explicit empty.
        explicit_none = "(none)" in glossary_sub
        if glossary_entries == 0 and not explicit_none:
            reasons.append(
                "'### Domain glossary' has no entries and no '(none)' marker"
            )
        if glossary_placeholder_hits > 0:
            reasons.append(
                f"'### Domain glossary' contains {glossary_placeholder_hits} "
                "template placeholder fragment(s)"
            )

    is_complete = (
        not missing
        and file_table_rows > 0
        and file_table_placeholder_hits == 0
        and glossary_placeholder_hits == 0
    )

    return BaselineContextReport(
        section_present=True,
        missing_subsections=tuple(missing),
        file_table_rows=file_table_rows,
        file_table_placeholder_hits=file_table_placeholder_hits,
        glossary_entries=glossary_entries,
        glossary_placeholder_hits=glossary_placeholder_hits,
        is_complete=is_complete,
        reasons=tuple(reasons),
    )
