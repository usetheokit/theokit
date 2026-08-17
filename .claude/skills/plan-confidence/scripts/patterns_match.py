"""Slice-local matcher: find `*-patterns` skills applicable to a plan.

Replicates the matching shape used by `auto-plan/scripts/assess_confidence.py`
(`score_patterns_skills`) and `review/scripts/detect_domain.py`
(`_patterns_skills_text`): glob `skills/*-patterns`, read the frontmatter
`description:` line, and report a hit when any plan keyword appears in it.

Deliberately duplicated per slice (ADR D2 of `patterns-consumption-gate-plan`):
slices run isolated per-process (`scripts/run_slice_tests.sh`), so a shared
top-level import would break the isolation the harness depends on.
"""
from __future__ import annotations

import re
from pathlib import Path

_DESCRIPTION_RE = re.compile(r"^description:\s*(.+?)$", re.MULTILINE)


def find_applicable_patterns_skills(ecosystem_dir: Path, keywords: list[str]) -> list[str]:
    """Return the names of `*-patterns` skill dirs whose description matches a keyword.

    Matching is a case-insensitive substring of any keyword against the
    frontmatter `description:` line only (not the whole body) — the same narrow
    signal as the two sibling precedents. Returns dir names sorted for
    determinism.
    """
    skills_dir = ecosystem_dir / "skills"
    if not skills_dir.is_dir():
        return []
    matched: list[str] = []
    for skill_dir in sorted(skills_dir.glob("*-patterns")):
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            continue
        text = skill_md.read_text(encoding="utf-8-sig", errors="ignore")
        m = _DESCRIPTION_RE.search(text)
        if not m:
            continue
        desc = m.group(1).lower()
        if any(kw in desc for kw in keywords):
            matched.append(skill_dir.name)
    return matched
