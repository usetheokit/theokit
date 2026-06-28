"""Fix #3 — pt-BR smell detection tests."""
from __future__ import annotations

from pathlib import Path


from check_spec_smells import check_spec_smells  # noqa: E402

SKILL_ROOT = Path(__file__).parent.parent
RUBRIC = SKILL_ROOT / "templates" / "rubric-v1.md"


def _write(tmp_path: Path, content: str) -> Path:
    p = tmp_path / "plan.md"
    p.write_text(content, encoding="utf-8")
    return p


def test_smell_pt_weak_imperative_deveria(tmp_path: Path) -> None:
    plan = _write(tmp_path, "O sistema deveria processar.\n")
    report = check_spec_smells(plan, RUBRIC)
    assert report.by_category.get("weak_imperatives", 0) >= 1


def test_smell_pt_weak_imperative_poderia(tmp_path: Path) -> None:
    plan = _write(tmp_path, "Poderia ser melhorado.\n")
    report = check_spec_smells(plan, RUBRIC)
    assert report.by_category.get("weak_imperatives", 0) >= 1


def test_smell_pt_weak_imperative_talvez(tmp_path: Path) -> None:
    plan = _write(tmp_path, "Talvez funcione.\n")
    report = check_spec_smells(plan, RUBRIC)
    assert report.by_category.get("weak_imperatives", 0) >= 1


def test_smell_pt_loophole_se_possivel(tmp_path: Path) -> None:
    plan = _write(tmp_path, "Aplicar se possivel.\n")
    report = check_spec_smells(plan, RUBRIC)
    assert report.by_category.get("loopholes", 0) >= 1


def test_smell_pt_loophole_quando_aplicavel(tmp_path: Path) -> None:
    plan = _write(tmp_path, "Use quando aplicavel.\n")
    report = check_spec_smells(plan, RUBRIC)
    assert report.by_category.get("loopholes", 0) >= 1


def test_smell_pt_subjective_rapido(tmp_path: Path) -> None:
    plan = _write(tmp_path, "Sistema rapido e eficiente.\n")
    report = check_spec_smells(plan, RUBRIC)
    # 'rapido' (subjective) + 'eficiente' (subjective) -> at least 2 hits
    assert report.by_category.get("subjective_adjectives", 0) >= 2


def test_smell_pt_non_verifiable_manutenivel(tmp_path: Path) -> None:
    plan = _write(tmp_path, "Codigo manutenivel.\n")
    report = check_spec_smells(plan, RUBRIC)
    assert report.by_category.get("non_verifiable", 0) >= 1


def test_smell_pt_vague_pronoun_isso(tmp_path: Path) -> None:
    plan = _write(tmp_path, "Algo aconteceu. Isso e ruim.\n")
    report = check_spec_smells(plan, RUBRIC)
    assert report.by_category.get("vague_pronouns", 0) >= 1


def test_smell_mixed_pt_en(tmp_path: Path) -> None:
    plan = _write(tmp_path, "The system should be rapido. Deveria ser eficiente.\n")
    report = check_spec_smells(plan, RUBRIC)
    # should (en) + deveria (pt) = 2 weak_imperatives
    assert report.by_category.get("weak_imperatives", 0) >= 2
    # rapido (pt) + eficiente (pt) = subjective
    assert report.by_category.get("subjective_adjectives", 0) >= 2
