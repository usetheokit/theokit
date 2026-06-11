"""T1.1 — tests for check_evidence_citations (M3 v0.1 detector)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from check_evidence_citations import (  # noqa: E402
    Citation,
    EvidenceReport,
    check_evidence_citations,
)


def _write_plan(tmp_path: Path, body: str) -> Path:
    plan = tmp_path / "demo-plan.md"
    plan.write_text(body, encoding="utf-8")
    return plan


def _make_project_root(tmp_path: Path, *, rules: dict[str, str] | None = None, blueprints: dict[str, str] | None = None) -> Path:
    """Create a fake project root with rules/ and knowledge-base/discoveries/blueprints/."""
    root = tmp_path / "project"
    (root / "rules").mkdir(parents=True)
    (root / "knowledge-base" / "discoveries" / "blueprints").mkdir(parents=True)
    if rules:
        for name, content in rules.items():
            (root / "rules" / name).write_text(content, encoding="utf-8")
    if blueprints:
        for name, content in blueprints.items():
            (root / "knowledge-base" / "discoveries" / "blueprints" / name).write_text(content, encoding="utf-8")
    return root


# ---------- Rule file refs ----------


def test_resolves_existing_rule_ref(tmp_path: Path) -> None:
    project_root = _make_project_root(tmp_path, rules={"architecture.md": "# Architecture\n\n## §1\nBody.\n"})
    plan = _write_plan(
        tmp_path,
        "# Plan\n\n### T1.1 — Task\n#### Evidence\n- `architecture.md` mandates DIP.\n",
    )
    report = check_evidence_citations(plan, project_root)
    assert report.unresolved_citations == ()
    assert report.total_citations >= 1


def test_flags_missing_rule_file(tmp_path: Path) -> None:
    project_root = _make_project_root(tmp_path)
    plan = _write_plan(
        tmp_path,
        "# Plan\n\n### T1.1 — Task\n#### Evidence\n- See `nonexistent.md` for details.\n",
    )
    report = check_evidence_citations(plan, project_root)
    assert any(c.raw_text == "nonexistent.md" for c in report.unresolved_citations)


def test_flags_missing_section(tmp_path: Path) -> None:
    project_root = _make_project_root(tmp_path, rules={"architecture.md": "# Architecture\n\n## §1\nBody.\n"})
    plan = _write_plan(
        tmp_path,
        "# Plan\n\n### T1.1 — Task\n#### Evidence\nReferência a `architecture.md §99`.\n",
    )
    report = check_evidence_citations(plan, project_root)
    flagged = [c for c in report.unresolved_citations if "architecture.md" in c.raw_text and "99" in c.raw_text]
    assert flagged, f"expected §99 to be flagged; got {report.unresolved_citations}"


# ---------- ADR intra-plano ----------


def test_resolves_intra_plan_adr(tmp_path: Path) -> None:
    project_root = _make_project_root(tmp_path)
    plan = _write_plan(
        tmp_path,
        "# Plan\n\n## ADRs\n\n### D8 — Some decision\nDetails.\n\n### T1.1 — Task\n#### Evidence\nADR D8 documenta.\n",
    )
    report = check_evidence_citations(plan, project_root)
    adr_unresolved = [c for c in report.unresolved_citations if c.kind == "adr"]
    assert adr_unresolved == [], f"D8 should resolve; got {adr_unresolved}"


def test_flags_undefined_adr(tmp_path: Path) -> None:
    project_root = _make_project_root(tmp_path)
    plan = _write_plan(
        tmp_path,
        "# Plan\n\n## ADRs\n\n### D1 — Only this one\nDetails.\n\n### T1.1 — Task\n#### Evidence\nVer ADR D99.\n",
    )
    report = check_evidence_citations(plan, project_root)
    assert any(c.kind == "adr" and "D99" in c.raw_text for c in report.unresolved_citations)


# ---------- Fenced code ----------


def test_ignores_citations_in_fenced_code(tmp_path: Path) -> None:
    project_root = _make_project_root(tmp_path)
    plan = _write_plan(
        tmp_path,
        "# Plan\n\n### T1.1 — Task\n#### Evidence\n```\nExample: ADR D999 e nonexistent.md\n```\n",
    )
    report = check_evidence_citations(plan, project_root)
    assert report.unresolved_citations == ()


def test_inline_code_citations_are_detected(tmp_path: Path) -> None:
    """Inline code is the idiomatic form for real citations — must be detected.

    Stripping inline code would silently skip the very things we want to verify.
    Meta-plans that document the detector accept some false positives; long
    examples should be fenced (multi-line ```) instead of inline.
    """
    project_root = _make_project_root(tmp_path)
    plan = _write_plan(
        tmp_path,
        "# Plan\n\n### T1.1 — Task\n#### Evidence\nVer `nonexistent.md §99` e ADR `D999`.\n",
    )
    report = check_evidence_citations(plan, project_root)
    flagged_kinds = {c.kind for c in report.unresolved_citations}
    assert "rule" in flagged_kinds
    assert "adr" in flagged_kinds


# ---------- Unbreakable Rules ----------


def test_unbreakable_rule_in_range(tmp_path: Path) -> None:
    project_root = _make_project_root(tmp_path)
    plan = _write_plan(
        tmp_path,
        "# Plan\n\n### T1.1 — Task\n#### Evidence\nUnbreakable Rule 7 (testes).\n",
    )
    report = check_evidence_citations(plan, project_root)
    rule_unresolved = [c for c in report.unresolved_citations if c.kind == "unbreakable_rule"]
    assert rule_unresolved == []


def test_unbreakable_rule_out_of_range(tmp_path: Path) -> None:
    project_root = _make_project_root(tmp_path)
    plan = _write_plan(
        tmp_path,
        "# Plan\n\n### T1.1 — Task\n#### Evidence\nUnbreakable Rule 14.\n",
    )
    report = check_evidence_citations(plan, project_root)
    assert any(c.kind == "unbreakable_rule" and "14" in c.raw_text for c in report.unresolved_citations)


# ---------- Empty plan ----------


def test_plan_without_evidence_returns_zero_citations(tmp_path: Path) -> None:
    project_root = _make_project_root(tmp_path)
    plan = _write_plan(
        tmp_path,
        "# Plan\n\n### T1.1 — Task\nNo evidence section here.\n",
    )
    report = check_evidence_citations(plan, project_root)
    assert report.total_citations == 0
    assert report.unresolved_citations == ()


# ---------- Dataclass contract ----------


def test_evidence_report_is_frozen() -> None:
    report = EvidenceReport(total_citations=0, unresolved_citations=())
    with pytest.raises((AttributeError, Exception)):
        report.total_citations = 5  # type: ignore[misc]


def test_citation_has_required_fields() -> None:
    c = Citation(kind="rule", raw_text="x.md", location_line=1, reason="missing")
    assert c.kind == "rule"
    assert c.raw_text == "x.md"
    assert c.location_line == 1
    assert c.reason == "missing"


# ---------- Blueprint refs (added after judge-codex flagged blueprint_red_suite_missing_direct_coverage) ----------


def test_resolves_blueprint_ref_when_section_exists_in_blueprints_set(tmp_path: Path) -> None:
    """Positive case: `Blueprint §Q1` resolves when ANY blueprint file in
    knowledge-base/discoveries/blueprints/ has a heading matching Q1.

    v0.1 contract documented in plan: detector binds by section anchor presence
    across the set of blueprint files (NOT by blueprint name). M3 v0.2 will
    introduce blueprint-id binding.
    """
    project_root = _make_project_root(
        tmp_path,
        blueprints={
            "loaders-blueprint.md": "# Loaders blueprint\n\n## Q1 — Which parsers?\nContent.\n",
        },
    )
    plan = _write_plan(
        tmp_path,
        "# Plan\n\n### T1.1 — Task\n#### Evidence\nVer Blueprint §Q1 para contexto.\n",
    )
    report = check_evidence_citations(plan, project_root)
    blueprint_unresolved = [c for c in report.unresolved_citations if c.kind == "blueprint"]
    assert blueprint_unresolved == [], (
        f"blueprint ref should resolve when section Q1 exists in the blueprint set; "
        f"got {blueprint_unresolved}"
    )


def test_flags_blueprint_ref_when_section_absent(tmp_path: Path) -> None:
    """Negative case: `Blueprint §Q99` flagged when NO blueprint contains Q99."""
    project_root = _make_project_root(
        tmp_path,
        blueprints={
            "loaders-blueprint.md": "# Loaders blueprint\n\n## Q1 — Which parsers?\nContent.\n",
        },
    )
    plan = _write_plan(
        tmp_path,
        "# Plan\n\n### T1.1 — Task\n#### Evidence\nVer Blueprint §Q99 que não existe.\n",
    )
    report = check_evidence_citations(plan, project_root)
    blueprint_unresolved = [c for c in report.unresolved_citations if c.kind == "blueprint"]
    assert blueprint_unresolved, (
        "Blueprint §Q99 should be flagged when no blueprint contains Q99 — got no findings"
    )
    assert any("Q99" in c.raw_text for c in blueprint_unresolved)


def test_flags_blueprint_ref_when_no_blueprints_dir(tmp_path: Path) -> None:
    """Defense-in-depth: when there are no blueprints at all, any Blueprint § is flagged."""
    project_root = tmp_path / "project"
    (project_root / "rules").mkdir(parents=True)
    # NOT creating knowledge-base/discoveries/blueprints/
    plan = _write_plan(
        tmp_path,
        "# Plan\n\n### T1.1 — Task\n#### Evidence\nVer Blueprint §Q1.\n",
    )
    report = check_evidence_citations(plan, project_root)
    blueprint_unresolved = [c for c in report.unresolved_citations if c.kind == "blueprint"]
    assert blueprint_unresolved
    assert any("no blueprints exist" in c.reason for c in blueprint_unresolved), (
        f"reason should mention missing blueprints dir; got {blueprint_unresolved}"
    )


# ---------- Whole-prose scope (added after judge-codex iter 3 flagged full_prose_scope_not_directly_proven_by_tests) ----------


def test_detector_flags_citation_in_prose_outside_evidence_block(tmp_path: Path) -> None:
    """DIRECT proof: detector scans WHOLE prose outside fenced code, not just `#### Evidence` blocks.

    Per Goal + ADR D1: a fabricated citation in Coverage Matrix / Test Plan / any
    prose section MUST be flagged. This test plants the citation OUTSIDE any
    `#### Evidence` block to prove the scope is whole-prose-outside-fenced.
    """
    project_root = _make_project_root(tmp_path)
    plan = _write_plan(
        tmp_path,
        "# Plan\n\n## Coverage Matrix\n\n"
        "| # | Gap | Task |\n"
        "|---|---|---|\n"
        "| G1 | See nonexistent-rule.md for context | T1.1 |\n\n"
        "## Test Plan\n\n"
        "Tests live in tests/.\n",
    )
    report = check_evidence_citations(plan, project_root)
    # `nonexistent-rule.md` cited in the Coverage Matrix prose (no `#### Evidence` block exists in this plan).
    # Must be flagged because scope is whole-prose-outside-fenced.
    assert any("nonexistent-rule.md" in c.raw_text for c in report.unresolved_citations), (
        f"detector failed to flag citation in non-Evidence prose; unresolved={report.unresolved_citations}"
    )


def test_detector_flags_citation_in_coverage_matrix(tmp_path: Path) -> None:
    """The Coverage Matrix is explicitly in scope per ADR D1 + Edge Cases."""
    project_root = _make_project_root(tmp_path)
    plan = _write_plan(
        tmp_path,
        "# Plan\n\n## Coverage Matrix\n\n"
        "| # | Gap | Task |\n|---|---|---|\n"
        "| G1 | Reference to missing-spec.md | T1 |\n\n"
        "### T1 — Task\n\n#### Objective\nDo X.\n",
    )
    report = check_evidence_citations(plan, project_root)
    assert any("missing-spec.md" in c.raw_text for c in report.unresolved_citations)


def test_detector_does_not_flag_when_token_is_only_in_fenced_block(tmp_path: Path) -> None:
    """Negative pair: when the same fabricated token lives ONLY inside a fenced code block,
    detector MUST NOT flag it. Proves the boundary is fenced-vs-prose (not section-name based)."""
    project_root = _make_project_root(tmp_path)
    plan = _write_plan(
        tmp_path,
        "# Plan\n\n## Coverage Matrix\n\n"
        "```\nExample of a fabricated citation: missing-doc.md §99\n```\n",
    )
    report = check_evidence_citations(plan, project_root)
    assert all(
        "missing-doc.md" not in c.raw_text for c in report.unresolved_citations
    ), "fenced citation should NOT be flagged"
