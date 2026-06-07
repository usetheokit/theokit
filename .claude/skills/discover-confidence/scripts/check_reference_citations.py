"""Reference-citation checker for /discover-execute blueprints (M2 deterministic).

Extracts every .claude/knowledge-base/references/{...} pattern in the blueprint and verifies each path
exists in the project's filesystem. Any fabricated citation triggers the
fabricated_citation hard cap (≤49).

Also computes citation density (citations per 200 words) — feeds the
soft_floor_citation_density_low cap (≤89).
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any


CITATION_RE = re.compile(r".claude/knowledge-base/references/[A-Za-z0-9_\-./]+")
BLOCKED_MARKER_RE = re.compile(r"<!--\s*BLOCKED:.*?-->", re.IGNORECASE | re.DOTALL)
LINE_SUFFIX_RE = re.compile(r":\d+(:\d+)?$")
WORD_RE = re.compile(r"\b\w+\b")


def _find_project_root(start: Path) -> Path:
    """Walk up from start looking for .claude/ or .git/."""
    current = start.resolve().parent if start.is_file() else start.resolve()
    while current != current.parent:
        if (current / ".claude").exists() or (current / ".git").exists():
            return current
        current = current.parent
    return start.resolve().parent if start.is_file() else start.resolve()


def _strip_line_suffix(citation: str) -> str:
    """Remove :line:col suffix (e.g., '.claude/knowledge-base/references/project-a/x.py:42' -> '.claude/knowledge-base/references/project-a/x.py')."""
    return LINE_SUFFIX_RE.sub("", citation)


def _word_count(content: str) -> int:
    return len(WORD_RE.findall(content))


def _is_explicitly_blocked(raw: str, match_end: int) -> bool:
    """Return True when a BLOCKED marker follows the citation within ~80 chars.

    Citations explicitly marked by /discover-improve as `<!-- BLOCKED: ... -->`
    are intentionally documented gaps, not fabrications. Do NOT count them as
    fabricated — they are part of the honest blocked-questions audit trail.
    """
    following = raw[match_end : match_end + 80]
    return bool(BLOCKED_MARKER_RE.search(following))


def check_reference_citations(blueprint_path: Path) -> dict[str, Any]:
    raw = blueprint_path.read_text(encoding="utf-8-sig")
    project_root = _find_project_root(blueprint_path)

    verified_set: set[str] = set()
    fabricated_set: set[str] = set()
    blocked_set: set[str] = set()
    seen_total: set[str] = set()

    for match in CITATION_RE.finditer(raw):
        cit = match.group(0)
        if _is_explicitly_blocked(raw, match.end()):
            blocked_set.add(cit)
            continue
        seen_total.add(cit)
        path = project_root / _strip_line_suffix(cit)
        if path.exists():
            verified_set.add(cit)
        else:
            fabricated_set.add(cit)

    verified = sorted(verified_set)
    fabricated = sorted(fabricated_set)
    blocked = sorted(blocked_set)

    total = len(seen_total)
    word_count = _word_count(raw)
    citation_density_per_200w = (total * 200 / word_count) if word_count > 0 else 0.0

    contributors: list[str] = []
    if verified:
        contributors.append(f"{len(verified)} verified .claude/knowledge-base/references/ citation(s)")
    if blocked:
        contributors.append(f"{len(blocked)} explicitly BLOCKED citation(s) (honest gaps)")
    detractors = [f"Fabricated citation: {c}" for c in fabricated[:3]]

    return {
        "total": total,
        "verified": len(verified),
        "fabricated": len(fabricated),
        "explicitly_blocked": len(blocked),
        "fabricated_paths": fabricated[:10],
        "blocked_paths": blocked[:10],
        "word_count": word_count,
        "citation_density_per_200w": round(citation_density_per_200w, 2),
        "contributors": contributors,
        "detractors": detractors,
    }
