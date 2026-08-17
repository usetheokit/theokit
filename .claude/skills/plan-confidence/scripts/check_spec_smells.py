"""Spec-smell detector for /to-plan plans (M2 deterministic, regex + dictionary).

Reads rubric-v1.md to get the list of smell categories with patterns and penalties.
For each category, scans the plan for matches with word-boundary regex.
Returns a SmellReport with hits, by_category counts, total_penalty.

v1.1 EC-13 known limitation: English-only dictionaries.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from _rubric_loader import load_rubric

CONTEXT_WINDOW = 20  # chars on each side of a match
FENCED_CODE_RE = re.compile(r"^```[^\n]*\n.*?^```", re.MULTILINE | re.DOTALL)
INLINE_CODE_RE = re.compile(r"`[^`\n]+`")


def _strip_code(content: str) -> str:
    """Remove code blocks (v1.1 EC-9 follow-up).

    Smells inside ```code``` or `inline` are typically examples or test names
    (e.g., 'RED: test_should_handle_empty'), not prose. Replace with whitespace
    of equal length to preserve line numbers.
    """
    def blank_keeping_lines(m: re.Match[str]) -> str:
        return re.sub(r"[^\n]", " ", m.group(0))

    no_fenced = FENCED_CODE_RE.sub(blank_keeping_lines, content)
    no_inline = INLINE_CODE_RE.sub(blank_keeping_lines, no_fenced)
    return no_inline


@dataclass(frozen=True)
class SmellHit:
    category: str
    pattern_matched: str
    line: int
    context: str


@dataclass(frozen=True)
class SmellReport:
    total_hits: int
    by_category: dict[str, int] = field(default_factory=dict)
    hits: tuple[SmellHit, ...] = field(default_factory=tuple)
    total_penalty: int = 0


def _build_category_regex(spec: dict[str, Any]) -> re.Pattern[str]:
    """Build a compiled regex for one smell category."""
    pattern_type = spec.get("pattern_type")
    if pattern_type == "regex":
        return re.compile(spec["pattern"], re.IGNORECASE | re.UNICODE)
    if pattern_type == "dictionary":
        entries = spec.get("words") or spec.get("phrases") or []
        if not entries:
            return re.compile(r"$.^")  # match nothing
        # Sort by length desc so multi-word phrases match first.
        sorted_entries = sorted(entries, key=len, reverse=True)
        escaped = [re.escape(e) for e in sorted_entries]
        # Use word boundaries; multi-word phrases naturally include spaces.
        joined = "|".join(escaped)
        return re.compile(rf"(?<!\w)({joined})(?!\w)", re.IGNORECASE | re.UNICODE)
    raise ValueError(f"Unknown pattern_type: {pattern_type!r}")


def _line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def _context_around(text: str, start: int, end: int) -> str:
    ctx_start = max(0, start - CONTEXT_WINDOW)
    ctx_end = min(len(text), end + CONTEXT_WINDOW)
    snippet = text[ctx_start:ctx_end].replace("\n", " ")
    return snippet.strip()


def check_spec_smells(plan_path: Path, rubric_path: Path) -> SmellReport:
    """Scan plan for smells defined in rubric. Returns SmellReport.

    v1.1 EC-9 follow-up: smells inside code blocks are skipped (examples, not prose).
    """
    raw = plan_path.read_text(encoding="utf-8-sig")
    content = _strip_code(raw)
    rubric = load_rubric(rubric_path)
    smells_spec = rubric.get("smells", {})

    # Penalty weights live under node id=4 in the rubric.
    penalty_weights: dict[str, int] = {}
    for node in rubric.get("nodes", []):
        if node.get("detector") == "spec_smells":
            penalty_weights = node.get("penalty_weights", {})
            break

    hits: list[SmellHit] = []
    by_category: dict[str, int] = {}

    for category, spec in smells_spec.items():
        try:
            regex = _build_category_regex(spec)
        except (re.error, KeyError) as exc:
            # Malformed rubric entry — skip but record
            raise ValueError(f"Invalid pattern for {category}: {exc}") from exc

        for match in regex.finditer(content):
            matched_text = match.group(0)
            line_no = _line_of(content, match.start())
            ctx = _context_around(content, match.start(), match.end())
            hits.append(
                SmellHit(
                    category=category,
                    pattern_matched=matched_text,
                    line=line_no,
                    context=ctx,
                )
            )

    # Aggregate
    for hit in hits:
        by_category[hit.category] = by_category.get(hit.category, 0) + 1

    total_penalty = sum(
        penalty_weights.get(cat, 0) * count for cat, count in by_category.items()
    )

    # Sort hits for determinism
    hits.sort(key=lambda h: (h.line, h.category, h.pattern_matched))

    return SmellReport(
        total_hits=len(hits),
        by_category=dict(sorted(by_category.items())),
        hits=tuple(hits),
        total_penalty=total_penalty,
    )
