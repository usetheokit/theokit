"""Patterns-skill consumption gate for `/to-plan` plans.

If a `*-patterns` skill is APPLICABLE to a plan (its frontmatter `description:`
shares a keyword with the plan's title/Goal) it must be CONSUMED — named in the
plan body (e.g. Prior Art / Baseline Context) OR overridden in an `## ADRs`
section. An applicable-but-ignored skill is a silently-skipped piece of domain
knowledge; `run_structural` caps such a plan at 49 (INVALID) under the stable id
`patterns_skill_ignored`.

The escape hatch for a heuristic false-positive is a one-line override ADR that
names the skill — cheap to add, and `/review` can challenge a hand-wavy override.

Stable identifier for the hard cap: `patterns_skill_ignored`.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from patterns_match import find_applicable_patterns_skills

FENCED_CODE_RE = re.compile(r"^(```|~~~)[^\n]*\n.*?^\1", re.MULTILINE | re.DOTALL)
_TITLE_RE = re.compile(r"^#\s+Plan:\s*(.+?)\s*$", re.MULTILINE)
_WORD_RE = re.compile(r"[a-z0-9]+")
_MIN_KW_LEN = 4


@dataclass(frozen=True)
class PatternsConsumptionReport:
    """Structural report for a plan's consumption of applicable patterns skills."""

    applicable: tuple[str, ...] = field(default_factory=tuple)
    cited: tuple[str, ...] = field(default_factory=tuple)
    overridden: tuple[str, ...] = field(default_factory=tuple)
    ignored: tuple[str, ...] = field(default_factory=tuple)
    is_clean: bool = True
    reasons: tuple[str, ...] = field(default_factory=tuple)


def _strip_code(content: str) -> str:
    """Blank fenced code blocks so a skill name mentioned only in a snippet does
    not count as a citation."""

    def blank(m: re.Match[str]) -> str:
        return re.sub(r"[^\n]", " ", m.group(0))

    return FENCED_CODE_RE.sub(blank, content)


def _extract_section(content: str, heading: str) -> str:
    """Return text between '## {heading}' and the next H2, or '' if absent."""
    pattern = re.compile(rf"^##\s+{re.escape(heading)}(?=\b|$)", re.MULTILINE)
    m = pattern.search(content)
    if not m:
        return ""
    start = m.end()
    nxt = re.search(r"^##\s+", content[start:], re.MULTILINE)
    end = (start + nxt.start()) if nxt else len(content)
    return content[start:end]


def _plan_keywords(content: str) -> list[str]:
    """Keywords for matching: word tokens (len >= 4) from the plan title + Goal."""
    title_match = _TITLE_RE.search(content)
    title = title_match.group(1) if title_match else ""
    goal = _extract_section(content, "Goal")
    text = f"{title}\n{goal}".lower()
    return sorted({w for w in _WORD_RE.findall(text) if len(w) >= _MIN_KW_LEN})


def check_patterns_consumption(plan_path: Path, ecosystem_dir: Path) -> PatternsConsumptionReport:
    """Inspect plan_path against the ecosystem's `*-patterns` skills."""
    raw = plan_path.read_text(encoding="utf-8-sig")
    stripped = _strip_code(raw)
    keywords = _plan_keywords(stripped)

    applicable = find_applicable_patterns_skills(ecosystem_dir, keywords)
    if not applicable:
        return PatternsConsumptionReport(is_clean=True)

    adr_section = _extract_section(stripped, "ADRs")
    body_wo_adr = stripped.replace(adr_section, "") if adr_section else stripped

    cited: list[str] = []
    overridden: list[str] = []
    ignored: list[str] = []
    for name in applicable:
        if name in body_wo_adr:
            cited.append(name)
        elif name in adr_section:
            overridden.append(name)
        else:
            ignored.append(name)

    reasons = tuple(
        f"applicable patterns skill `{n}` is neither cited in the plan body "
        "nor overridden in `## ADRs`"
        for n in ignored
    )
    return PatternsConsumptionReport(
        applicable=tuple(applicable),
        cited=tuple(cited),
        overridden=tuple(overridden),
        ignored=tuple(ignored),
        is_clean=not ignored,
        reasons=reasons,
    )
