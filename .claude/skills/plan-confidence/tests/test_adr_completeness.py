"""Fix #4 — ADR completeness with expanded fallback patterns."""
from __future__ import annotations

from pathlib import Path


from check_adr_completeness import check_adr_completeness  # noqa: E402


def _write(tmp_path: Path, content: str) -> Path:
    p = tmp_path / "plan.md"
    p.write_text(content, encoding="utf-8")
    return p


def test_adr_with_inline_alternativa_keyword(tmp_path: Path) -> None:
    plan = _write(
        tmp_path,
        "# Plan\n\n## ADRs\n\n"
        "### D1 — toy\n"
        "- Rationale: A alternativa de hooks foi rejeitada.\n"
        "- Consequences: OK\n",
    )
    report = check_adr_completeness(plan)
    assert report.with_alternatives == 1


def test_adr_with_trade_off_pattern(tmp_path: Path) -> None:
    plan = _write(
        tmp_path,
        "# Plan\n\n## ADRs\n\n"
        "### D1 — toy\n"
        "- Rationale: Trade-off entre simplicidade e performance.\n",
    )
    report = check_adr_completeness(plan)
    assert report.with_alternatives == 1


def test_adr_with_why_not_pattern(tmp_path: Path) -> None:
    plan = _write(
        tmp_path,
        "# Plan\n\n## ADRs\n\n"
        "### D1 — toy\n"
        "- Rationale: Why not use library X? Because Y.\n",
    )
    report = check_adr_completeness(plan)
    assert report.with_alternatives == 1


def test_adr_with_considered_pattern(tmp_path: Path) -> None:
    plan = _write(
        tmp_path,
        "# Plan\n\n## ADRs\n\n"
        "### D1 — toy\n"
        "- Rationale: Considered Approach X but chose Y because.\n",
    )
    report = check_adr_completeness(plan)
    assert report.with_alternatives == 1


def test_adr_with_pt_em_vez_de(tmp_path: Path) -> None:
    plan = _write(
        tmp_path,
        "# Plan\n\n## ADRs\n\n"
        "### D1 — toy\n"
        "- Rationale: Usamos X em vez de Y porque.\n",
    )
    report = check_adr_completeness(plan)
    assert report.with_alternatives == 1


def test_adr_without_alternatives_still_caught(tmp_path: Path) -> None:
    """Sanity: an ADR with zero alternative-mention should still be flagged."""
    plan = _write(
        tmp_path,
        "# Plan\n\n## ADRs\n\n"
        "### D1 — toy\n"
        "- Rationale: This is the right way.\n"
        "- Consequences: OK\n",
    )
    report = check_adr_completeness(plan)
    assert report.with_alternatives == 0
    assert "D1" in report.missing_alternatives


def test_adr_global_section_takes_precedence(tmp_path: Path) -> None:
    """Global 'Alternativas Rejeitadas' section still satisfies all ADRs."""
    plan = _write(
        tmp_path,
        "# Plan\n\n## ADRs\n\n"
        "### D1 — toy\n- Rationale: short.\n\n"
        "### D2 — toy\n- Rationale: short.\n\n"
        "## Alternativas Rejeitadas\n\n"
        "### Alt A: Some option\n"
        "Rejeitada por D1 porque...\n",
    )
    report = check_adr_completeness(plan)
    assert report.completeness_ratio == 1.0
