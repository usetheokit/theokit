"""Tests for check_patterns_consumption (patterns-skill consumption gate).

A plan that ignores an applicable `*-patterns` skill (one whose frontmatter
`description:` shares a keyword with the plan's title/Goal) must be flagged,
UNLESS the plan cites the skill OR overrides it in an `## ADRs` section.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from check_patterns_consumption import check_patterns_consumption  # noqa: E402


def _ecosystem(tmp: Path, patterns: dict[str, str]) -> Path:
    """Create an ecosystem dir with skills/<name>/SKILL.md for each entry.

    `patterns` maps a skill dir name (e.g. 'pgvector-patterns') to its
    frontmatter description line.
    """
    skills = tmp / "skills"
    skills.mkdir(parents=True, exist_ok=True)
    for name, desc in patterns.items():
        d = skills / name
        d.mkdir(parents=True, exist_ok=True)
        (d / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: {desc}\nuser-invocable: true\n---\n# {name}\n"
        )
    return tmp


def _plan(tmp: Path, content: str) -> Path:
    p = tmp / "the-plan-plan.md"
    p.write_text(content)
    return p


def test_no_patterns_skills_is_clean():
    tmp = Path(tempfile.mkdtemp())
    eco = _ecosystem(tmp, {})  # no *-patterns skills at all
    plan = _plan(tmp, "# Plan: pgvector schema migration\n## Goal\nEnable pgvector indexing.\n")
    r = check_patterns_consumption(plan, eco)
    assert r.applicable == ()
    assert r.is_clean is True


def test_applicable_but_ignored_flags():
    tmp = Path(tempfile.mkdtemp())
    eco = _ecosystem(tmp, {"pgvector-patterns": "Use when planning pgvector schema or indexing."})
    # Plan talks about pgvector but never names the skill.
    plan = _plan(tmp, "# Plan: pgvector schema migration\n## Goal\nEnable pgvector indexing so queries are fast.\n")
    r = check_patterns_consumption(plan, eco)
    assert "pgvector-patterns" in r.applicable
    assert "pgvector-patterns" in r.ignored
    assert r.is_clean is False


def test_applicable_and_cited_is_clean():
    tmp = Path(tempfile.mkdtemp())
    eco = _ecosystem(tmp, {"pgvector-patterns": "Use when planning pgvector schema or indexing."})
    plan = _plan(
        tmp,
        "# Plan: pgvector schema migration\n## Goal\nEnable pgvector indexing.\n"
        "## Prior Art & Related Work\n- Patterns skills: `pgvector-patterns` — Pattern P1 consumed.\n",
    )
    r = check_patterns_consumption(plan, eco)
    assert "pgvector-patterns" in r.applicable
    assert "pgvector-patterns" in r.cited
    assert r.ignored == ()
    assert r.is_clean is True


def test_override_in_adr_is_clean():
    tmp = Path(tempfile.mkdtemp())
    eco = _ecosystem(tmp, {"pgvector-patterns": "Use when planning pgvector schema or indexing."})
    plan = _plan(
        tmp,
        "# Plan: pgvector schema migration\n## Goal\nEnable pgvector indexing.\n"
        "## ADRs\n### D1 — Diverge from pgvector-patterns\n- **Decision:** override `pgvector-patterns` Pattern P1 because Y.\n",
    )
    r = check_patterns_consumption(plan, eco)
    assert "pgvector-patterns" in r.overridden
    assert r.ignored == ()
    assert r.is_clean is True


def test_fenced_code_mention_does_not_count():
    tmp = Path(tempfile.mkdtemp())
    eco = _ecosystem(tmp, {"pgvector-patterns": "Use when planning pgvector schema or indexing."})
    # The only mention of the skill name is inside a fenced code block → must not count as citation.
    plan = _plan(
        tmp,
        "# Plan: pgvector schema migration\n## Goal\nEnable pgvector indexing.\n"
        "## Context\n```\nls skills/pgvector-patterns/\n```\n",
    )
    r = check_patterns_consumption(plan, eco)
    assert "pgvector-patterns" in r.applicable
    assert "pgvector-patterns" in r.ignored
    assert r.is_clean is False
