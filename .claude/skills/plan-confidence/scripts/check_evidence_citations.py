"""M3 v0.1 — fabricated_citation detector for /plan-confidence.

Scans a plan's `#### Evidence` blocks (and prose surrounding them) for citations
of the following kinds, and flags ones that do not resolve:

  - rule            — `name.md` or `name.md §X`
  - blueprint       — `Blueprint §X`
  - adr             — `D{n}` or `ADR D{n}` (intra-plan ADR)
  - unbreakable_rule — `Unbreakable Rule {n}` (n must be in 1..13)

Citations inside fenced code blocks are ignored (they are examples).

Per `plan-confidence-golden-rule.md` § 3, ≥1 unresolved citation → hard cap 49
(stable identifier: `fabricated_citation`).

Per ADR D1 of `harden-fabrication-and-cq-gate-plan.md`, code-file refs
(`src/foo.py:42`) are out-of-scope for v0.1 (overlap with /code-quality D2).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

UNBREAKABLE_RULE_MAX = 13

# Rule refs: `architecture.md` or `architecture.md §1` or `architecture.md §"Some Title"`.
# Excludes paths containing slashes (e.g. `knowledge-base/foo.md`) because the resolver below
# walks the project root; v0.1 keeps the regex conservative. Backtick is explicitly excluded
# from the section token so that ``architecture.md §1`` strips properly when inline code
# normalizes to whitespace mid-match.
_RULE_REF_RE = re.compile(
    r"(?<![A-Za-z0-9_/-])([a-z][a-z0-9_-]*\.md)"
    r"(?:\s*§\s*(?:\"([^\"]+)\"|([^\s,.;)\"`]+)))?"
)

# Blueprint refs: `Blueprint §Q1` or `Blueprint §"Cross-cutting"`.
_BLUEPRINT_REF_RE = re.compile(
    r"Blueprint\s*§\s*(?:\"([^\"]+)\"|([A-Za-z0-9][^\s,.;)\"`]*))"
)

# ADR refs: `ADR D8` OR standalone `D8` followed by word boundary (skip dates like 2026-06-04).
# Backtick is a valid boundary because plans idiomatically wrap citations as ``D8``.
_ADR_REF_RE = re.compile(r"\bADR\s+(D\d+)\b|(?<![A-Za-z0-9_])(D\d+)(?=[\s,.;)`]|$)")

_UNBREAKABLE_RULE_RE = re.compile(r"Unbreakable\s+Rule\s+(\d+)")

# Section header in markdown — captures `## Title`, `### Title`, etc.
_MD_HEADER_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*$", re.MULTILINE)

# Fenced code blocks (``` or ~~~). DOTALL so they span multiple lines.
_FENCED_CODE_RE = re.compile(r"^(```|~~~)[^\n]*\n.*?^\1", re.MULTILINE | re.DOTALL)


@dataclass(frozen=True)
class Citation:
    """A single citation extracted from a plan.

    `kind`: one of {"rule", "blueprint", "adr", "unbreakable_rule"}.
    `raw_text`: the exact substring matched (e.g., "architecture.md §99").
    `location_line`: 1-based line number in the plan.
    `reason`: human-readable explanation of why it failed to resolve.
    """

    kind: str
    raw_text: str
    location_line: int
    reason: str


@dataclass(frozen=True)
class EvidenceReport:
    """Structural report for evidence citations in a plan."""

    total_citations: int
    unresolved_citations: tuple[Citation, ...] = field(default_factory=tuple)


def check_evidence_citations(plan_path: Path, project_root: Path) -> EvidenceReport:
    """Scan plan for citations and verify each resolves.

    Citations inside fenced code blocks are ignored. Headers are also stripped
    from the scan (they are titles, not claims). The plan itself is the
    authoritative source for intra-plan ADR resolution.
    """
    content = plan_path.read_text(encoding="utf-8-sig")
    prose, line_index = _strip_fenced_code(content)

    defined_adrs = _collect_defined_adrs(content)
    citations: list[tuple[Citation, bool]] = []  # (citation, resolved?)

    citations.extend(_scan_rule_refs(prose, line_index, project_root))
    citations.extend(_scan_blueprint_refs(prose, line_index, project_root))
    citations.extend(_scan_adr_refs(prose, line_index, defined_adrs))
    citations.extend(_scan_unbreakable_rule_refs(prose, line_index))

    unresolved = tuple(c for c, resolved in citations if not resolved)
    return EvidenceReport(total_citations=len(citations), unresolved_citations=unresolved)


# ---------------------------------------------------------------------------
# Strip code + line indexing
# ---------------------------------------------------------------------------


def _strip_fenced_code(content: str) -> tuple[str, list[int]]:
    """Replace fenced code spans with whitespace (preserving newlines).

    INLINE code spans (single backticks) are deliberately kept: plans idiomatically
    write real citations as ``architecture.md §1`` and stripping them would silently
    skip the very thing we want to verify. Meta-plans that document the detector
    itself accept some false positives — fence long examples instead.

    Returns (stripped_content, line_index) where line_index[i] is the 1-based
    line number of character offset i in the original content.
    """

    def blank(m: re.Match[str]) -> str:
        return re.sub(r"[^\n]", " ", m.group(0))

    stripped = _FENCED_CODE_RE.sub(blank, content)
    line_index = _build_line_index(stripped)
    return stripped, line_index


def _build_line_index(content: str) -> list[int]:
    """Return list where index[i] = 1-based line number of char i."""
    out = [1] * (len(content) + 1)
    line = 1
    for i, ch in enumerate(content):
        out[i] = line
        if ch == "\n":
            line += 1
    out[len(content)] = line
    return out


# ---------------------------------------------------------------------------
# Rule refs
# ---------------------------------------------------------------------------


def _scan_rule_refs(
    prose: str, line_index: list[int], project_root: Path
) -> list[tuple[Citation, bool]]:
    out: list[tuple[Citation, bool]] = []
    for m in _RULE_REF_RE.finditer(prose):
        filename = m.group(1)
        section = m.group(2) or m.group(3)
        raw = m.group(0)
        line_no = line_index[m.start()]
        resolved_path = _resolve_rule_file(filename, project_root)
        if resolved_path is None:
            out.append(
                (
                    Citation(
                        kind="rule",
                        raw_text=filename,
                        location_line=line_no,
                        reason=f"file {filename!r} not found in rules/, knowledge-base/, or project root",
                    ),
                    False,
                )
            )
            continue
        if section is None:
            out.append((Citation(kind="rule", raw_text=filename, location_line=line_no, reason=""), True))
            continue
        if _section_exists(resolved_path, section):
            out.append((Citation(kind="rule", raw_text=raw, location_line=line_no, reason=""), True))
        else:
            out.append(
                (
                    Citation(
                        kind="rule",
                        raw_text=raw,
                        location_line=line_no,
                        reason=f"section §{section!r} not found in {filename}",
                    ),
                    False,
                )
            )
    return out


def _resolve_rule_file(filename: str, project_root: Path) -> Path | None:
    """Locate filename in conventional places. None if not found."""
    # Common locations, ordered by specificity.
    candidates = [
        project_root / "rules" / filename,
        project_root / ".claude" / "rules" / filename,
        project_root / "knowledge-base" / filename,
        project_root / filename,  # e.g. CHANGELOG.md, CLAUDE.md
    ]
    for c in candidates:
        if c.exists() and c.is_file():
            return c
    # Last-resort: shallow search inside knowledge-base/ (handles ADRs etc.).
    kb = project_root / "knowledge-base"
    if kb.exists():
        try:
            for p in kb.rglob(filename):
                if p.is_file():
                    return p
        except OSError:
            pass
    return None


def _section_exists(file_path: Path, section: str) -> bool:
    """Return True if a markdown header in file_path matches `section`.

    Match strategy: section token compared against (a) header title verbatim,
    (b) header normalized (lowercase, whitespace collapsed), (c) trailing
    portion of the header. The token `1` matches a header like `## §1 Foo` or
    `## 1 — Foo` or `## D1 — Title`. The token `"Cross-cutting"` matches
    `## Cross-cutting Comparison`.
    """
    try:
        content = file_path.read_text(encoding="utf-8-sig")
    except OSError:
        return False
    section_norm = section.strip().lower()
    for m in _MD_HEADER_RE.finditer(content):
        title = m.group(2).strip()
        title_norm = title.lower()
        if section_norm in title_norm:
            return True
        # Tolerate "§N" or just "N" in titles like "## §1 — Foo".
        if section_norm.lstrip("§").strip() and section_norm.lstrip("§").strip() in title_norm:
            return True
    return False


# ---------------------------------------------------------------------------
# Blueprint refs
# ---------------------------------------------------------------------------


def _scan_blueprint_refs(
    prose: str, line_index: list[int], project_root: Path
) -> list[tuple[Citation, bool]]:
    out: list[tuple[Citation, bool]] = []
    blueprints_dir = project_root / "knowledge-base" / "discoveries" / "blueprints"
    available = []
    if blueprints_dir.exists():
        try:
            available = [p for p in blueprints_dir.iterdir() if p.is_file() and p.suffix == ".md"]
        except OSError:
            available = []
    for m in _BLUEPRINT_REF_RE.finditer(prose):
        section = m.group(1) or m.group(2)
        raw = m.group(0)
        line_no = line_index[m.start()]
        if not available:
            out.append(
                (
                    Citation(
                        kind="blueprint",
                        raw_text=raw,
                        location_line=line_no,
                        reason="no blueprints exist in knowledge-base/discoveries/blueprints/",
                    ),
                    False,
                )
            )
            continue
        resolved = any(_section_exists(bp, section) for bp in available)
        if resolved:
            out.append((Citation(kind="blueprint", raw_text=raw, location_line=line_no, reason=""), True))
        else:
            out.append(
                (
                    Citation(
                        kind="blueprint",
                        raw_text=raw,
                        location_line=line_no,
                        reason=f"section §{section!r} not found in any blueprint",
                    ),
                    False,
                )
            )
    return out


# ---------------------------------------------------------------------------
# Intra-plan ADRs
# ---------------------------------------------------------------------------


def _collect_defined_adrs(content: str) -> set[str]:
    """Return set of ADR identifiers defined in the plan (e.g., {"D1", "D2"})."""
    defined: set[str] = set()
    for m in _MD_HEADER_RE.finditer(content):
        title = m.group(2).strip()
        adr_match = re.match(r"^(D\d+)\b", title)
        if adr_match:
            defined.add(adr_match.group(1))
    return defined


def _scan_adr_refs(
    prose: str, line_index: list[int], defined_adrs: set[str]
) -> list[tuple[Citation, bool]]:
    out: list[tuple[Citation, bool]] = []
    seen: set[tuple[int, str]] = set()  # dedupe by (line, id) to avoid double-count from regex alternation
    for m in _ADR_REF_RE.finditer(prose):
        adr_id = m.group(1) or m.group(2)
        if adr_id is None:
            continue
        line_no = line_index[m.start()]
        key = (line_no, adr_id)
        if key in seen:
            continue
        seen.add(key)
        resolved = adr_id in defined_adrs
        if resolved:
            out.append((Citation(kind="adr", raw_text=adr_id, location_line=line_no, reason=""), True))
        else:
            out.append(
                (
                    Citation(
                        kind="adr",
                        raw_text=adr_id,
                        location_line=line_no,
                        reason=f"ADR {adr_id} is referenced but not defined under '## ADRs' in the plan",
                    ),
                    False,
                )
            )
    return out


# ---------------------------------------------------------------------------
# Unbreakable Rules
# ---------------------------------------------------------------------------


def _scan_unbreakable_rule_refs(
    prose: str, line_index: list[int]
) -> list[tuple[Citation, bool]]:
    out: list[tuple[Citation, bool]] = []
    for m in _UNBREAKABLE_RULE_RE.finditer(prose):
        num_str = m.group(1)
        line_no = line_index[m.start()]
        try:
            num = int(num_str)
        except ValueError:
            continue
        raw = m.group(0)
        if 1 <= num <= UNBREAKABLE_RULE_MAX:
            out.append((Citation(kind="unbreakable_rule", raw_text=raw, location_line=line_no, reason=""), True))
        else:
            out.append(
                (
                    Citation(
                        kind="unbreakable_rule",
                        raw_text=raw,
                        location_line=line_no,
                        reason=f"Unbreakable Rule {num} is out of range (1..{UNBREAKABLE_RULE_MAX})",
                    ),
                    False,
                )
            )
    return out
