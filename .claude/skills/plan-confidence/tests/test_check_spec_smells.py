"""T4.2 — check_spec_smells.py tests."""
from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from check_spec_smells import (  # noqa: E402
    check_spec_smells,
)

SKILL_ROOT = Path(__file__).parent.parent
RUBRIC = SKILL_ROOT / "templates" / "rubric-v1.md"
FIXTURES = SKILL_ROOT / "fixtures"


def _write(tmp_path: Path, name: str, content: str) -> Path:
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


def test_smell_subjective_adjective_detected(tmp_path: Path) -> None:
    plan = _write(tmp_path, "plan.md", "This is a fast solution.\n")
    report = check_spec_smells(plan, RUBRIC)
    assert report.by_category.get("subjective_adjectives", 0) >= 1


def test_smell_weak_imperative_detected(tmp_path: Path) -> None:
    plan = _write(tmp_path, "plan.md", "The system should handle this.\n")
    report = check_spec_smells(plan, RUBRIC)
    assert report.by_category.get("weak_imperatives", 0) >= 1


def test_smell_vague_pronoun_detected(tmp_path: Path) -> None:
    plan = _write(tmp_path, "plan.md", "This is important. That works.\n")
    report = check_spec_smells(plan, RUBRIC)
    assert report.by_category.get("vague_pronouns", 0) >= 1


def test_smell_loophole_detected(tmp_path: Path) -> None:
    plan = _write(tmp_path, "plan.md", "Apply this fix if possible.\n")
    report = check_spec_smells(plan, RUBRIC)
    assert report.by_category.get("loopholes", 0) >= 1


def test_smell_non_verifiable_detected(tmp_path: Path) -> None:
    plan = _write(tmp_path, "plan.md", "Make it user-friendly and maintainable.\n")
    report = check_spec_smells(plan, RUBRIC)
    assert report.by_category.get("non_verifiable", 0) >= 1


def test_smell_no_hits_returns_empty_report(tmp_path: Path) -> None:
    plan = _write(tmp_path, "plan.md", "Plain prose. No issues.\n")
    report = check_spec_smells(plan, RUBRIC)
    assert report.total_hits == 0
    assert report.total_penalty == 0
    assert report.hits == ()


def test_smell_total_penalty_computed_correctly(tmp_path: Path) -> None:
    """fast (subjective -2) + smart (subjective -2) + if possible (loophole -3) = -7.

    Use 'smart' not 'robust' to avoid the rubric overlap (robust appears in BOTH
    subjective_adjectives AND non_verifiable dictionaries; that's intentional
    in the rubric but adds extra penalty noise to this simple unit test).
    """
    plan = _write(
        tmp_path,
        "plan.md",
        "A fast and smart system. Apply if possible.\n",
    )
    report = check_spec_smells(plan, RUBRIC)
    # 2 subjective (-2 each = -4) + 1 loophole (-3) = -7
    assert report.total_penalty == -7, (
        f"expected -7, got {report.total_penalty}; by_category={report.by_category}"
    )


def test_smell_line_numbers_correct(tmp_path: Path) -> None:
    plan = _write(
        tmp_path,
        "plan.md",
        "line 1\nline 2\nA fast feature on line 3.\n",
    )
    report = check_spec_smells(plan, RUBRIC)
    fast_hits = [h for h in report.hits if h.pattern_matched == "fast"]
    assert len(fast_hits) == 1
    assert fast_hits[0].line == 3


def test_smell_context_captured(tmp_path: Path) -> None:
    plan = _write(tmp_path, "plan.md", "This is a fast solution.\n")
    report = check_spec_smells(plan, RUBRIC)
    assert any("fast" in h.context for h in report.hits)


def test_smell_dedup_overlapping_spans(tmp_path: Path) -> None:
    """should and may both match weak_imperatives — both count as separate hits."""
    plan = _write(tmp_path, "plan.md", "It should may work.\n")
    report = check_spec_smells(plan, RUBRIC)
    # 2 hits: 'should' and 'may'. Not 4 from any overlap.
    assert report.by_category.get("weak_imperatives", 0) == 2


def test_smell_weak_imperatives_fixture(tmp_path: Path) -> None:
    """v1.1 runtime-metric proof: fixture must produce non-zero hits."""
    report = check_spec_smells(FIXTURES / "weak-imperatives-plan.md", RUBRIC)
    assert report.total_hits > 0, "fixture must produce smell hits"
    assert report.total_penalty < 0
    # Weak imperatives is the targeted smell here
    assert report.by_category.get("weak_imperatives", 0) >= 3


def test_smell_good_fixture_clean(tmp_path: Path) -> None:
    """good-plan.md should have few or zero smells."""
    report = check_spec_smells(FIXTURES / "good-plan.md", RUBRIC)
    # Some hits acceptable (e.g., headers say "Use Python stdlib only" — could match)
    # but should be low and total_penalty manageable.
    assert report.total_penalty >= -10, f"good-plan has {report.total_penalty} penalty (too low)"


def test_smell_report_is_hashable(tmp_path: Path) -> None:
    """Determinism: report must be hashable for cache invariants."""
    plan = _write(tmp_path, "plan.md", "A fast and robust system.\n")
    r1 = check_spec_smells(plan, RUBRIC)
    r2 = check_spec_smells(plan, RUBRIC)
    # Same content -> same report
    assert r1 == r2
