"""T2.1 — plan-confidence-golden-rule.md structure tests (v1.1 EC-6: 6 H2 sections)."""
from __future__ import annotations

from pathlib import Path


def _read_golden_rule(rules_dir: Path) -> str:
    return (rules_dir / "plan-confidence-golden-rule.md").read_text(encoding="utf-8")


def test_golden_rule_exists(rules_dir: Path) -> None:
    assert (rules_dir / "plan-confidence-golden-rule.md").exists()


def test_golden_rule_has_6_required_h2_sections(rules_dir: Path) -> None:
    """v1.1 EC-6 fix: structure has 6 H2 sections (was tested as 5 in v1.0)."""
    content = _read_golden_rule(rules_dir)
    required = [
        "## The Rule",
        "## What it requires",
        "## Why this rule exists",
        "## Rules that cannot be bent",
        "## When this rule may change",
        "## Related",
    ]
    for section in required:
        assert section in content, f"missing section: {section}"


def test_golden_rule_has_rules_that_cannot_be_bent_table(rules_dir: Path) -> None:
    content = _read_golden_rule(rules_dir)
    pos = content.find("## Rules that cannot be bent")
    assert pos != -1
    after = content[pos:]
    # A Markdown table has a header row with pipes and a separator row of dashes/pipes.
    assert "| Rule |" in after or "| rule |" in after.lower()
    assert "|---" in after or "| --" in after.lower()


def test_golden_rule_table_has_at_least_4_rows(rules_dir: Path) -> None:
    content = _read_golden_rule(rules_dir)
    pos = content.find("## Rules that cannot be bent")
    assert pos != -1
    # Stop at the next H2
    end = content.find("\n## ", pos + 1)
    section = content[pos:end if end != -1 else len(content)]
    pipe_lines = [
        line for line in section.splitlines()
        if line.strip().startswith("|") and "|" in line[1:]
    ]
    # Subtract header (1) and separator (1) = at least 4 data rows means total >= 6
    assert len(pipe_lines) >= 6, f"expected >=6 pipe lines (1 header + 1 sep + 4 rows), got {len(pipe_lines)}"


def test_golden_rule_mentions_coverage_matrix_hard_cap_49(rules_dir: Path) -> None:
    content = _read_golden_rule(rules_dir)
    content_lower = content.lower()
    assert "coverage matrix" in content_lower
    assert "49" in content


def test_golden_rule_documents_m3_status(rules_dir: Path) -> None:
    """The golden rule must declare the status of every M3 milestone shipped.

    M3 has multiple sub-milestones (v0.1 active, v0.2 deferred per ADR). The test
    was originally written when M3 was wholly future — now M3 v0.1 is ENFORCED and
    M3 v0.2 (code-file refs `src/foo.py:42`) is DEFERRED. The contract this test
    pins is "the golden rule states the status of M3 in some explicit form" — so
    a reader cannot mistakenly assume an M3 sub-milestone is or is not active.
    """
    content = _read_golden_rule(rules_dir)
    content_lower = content.lower()
    assert "m3" in content_lower, "golden-rule does not mention M3 milestone(s) at all"
    status_signals = (
        "future",
        "futuro",
        "futur",
        "deferred",
        "active",
        "enforced",
        "citation fabricada",
        "citação fabricada",
        "fabricated_citation",
        "fabricated citation",
    )
    assert any(sig in content_lower for sig in status_signals), (
        "golden-rule mentions M3 but does not declare its status "
        "(future/deferred/active/enforced/citation_*)"
    )


def test_golden_rule_has_related_section_with_links(rules_dir: Path) -> None:
    content = _read_golden_rule(rules_dir)
    pos = content.find("## Related")
    assert pos != -1
    after = content[pos:]
    # Expect references to skill, thresholds, allowlist, defaults (current architecture).
    # Historic note: previous design referenced ADR + sota report files. After the
    # concepts/ + reviews/ tree was emptied in 2026-05-21, the golden rule's Related
    # section was reduced to the surfaces that still exist on disk.
    for keyword in ["SKILL.md", "thresholds", "allowlist", "defaults"]:
        assert keyword.lower() in after.lower(), f"Related section missing: {keyword}"


def test_golden_rule_under_300_lines(rules_dir: Path) -> None:
    content = _read_golden_rule(rules_dir)
    assert len(content.splitlines()) <= 300


def test_golden_rule_says_inquebravel(rules_dir: Path) -> None:
    content = _read_golden_rule(rules_dir)
    content_lower = content.lower()
    assert "inquebr" in content_lower or "inquebravel" in content_lower or "unbreakable" in content_lower
