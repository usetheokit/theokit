"""T1.2 — rubric-v1.md YAML structure tests (v1.1 EC-3 fix: weights sum 1.0)."""
from __future__ import annotations

from pathlib import Path

import yaml


def _load_rubric(skill_root: Path) -> dict[str, object]:
    """Extract the YAML block from rubric-v1.md and parse it."""
    content = (skill_root / "templates" / "rubric-v1.md").read_text(encoding="utf-8")
    start = content.find("```yaml")
    assert start != -1, "rubric-v1.md must have a ```yaml block"
    end = content.find("```", start + len("```yaml"))
    assert end != -1, "unclosed ```yaml block"
    yaml_block = content[start + len("```yaml"):end].strip()
    return yaml.safe_load(yaml_block)


def test_rubric_yaml_parses(skill_root: Path) -> None:
    rubric = _load_rubric(skill_root)
    assert isinstance(rubric, dict)
    assert "version" in rubric


def test_rubric_version_is_1(skill_root: Path) -> None:
    rubric = _load_rubric(skill_root)
    assert rubric["version"] == 1


def test_rubric_has_4_nodes(skill_root: Path) -> None:
    rubric = _load_rubric(skill_root)
    assert isinstance(rubric["nodes"], list)
    assert len(rubric["nodes"]) == 4


def test_rubric_completude_weights_sum_to_one(skill_root: Path) -> None:
    """v1.1 EC-3 fix: completeness weights sum to 1.0 (was 0.9 in v1.0)."""
    rubric = _load_rubric(skill_root)
    completude_weights = [
        n["weight"] for n in rubric["nodes"] if n["dimension"] == "completeness"
    ]
    assert len(completude_weights) == 3, "expected 3 completeness nodes"
    assert abs(sum(completude_weights) - 1.0) < 1e-9, (
        f"completeness weights sum to {sum(completude_weights)}, expected 1.0"
    )


def test_rubric_risco_estrutural_weight_is_one(skill_root: Path) -> None:
    rubric = _load_rubric(skill_root)
    risco_weights = [
        n["weight"] for n in rubric["nodes"] if n["dimension"] == "structural_risk"
    ]
    assert len(risco_weights) == 1
    assert risco_weights[0] == 1.0


def test_rubric_hard_caps_in_allowed_set(skill_root: Path) -> None:
    rubric = _load_rubric(skill_root)
    for node in rubric["nodes"]:
        if node.get("failure_action") == "hard_cap":
            assert node["hard_cap_value"] in (49, 70), (
                f"hard_cap_value {node['hard_cap_value']} not in {{49, 70}}"
            )


def test_rubric_smells_dictionary_non_empty(skill_root: Path) -> None:
    rubric = _load_rubric(skill_root)
    assert "smells" in rubric
    smells = rubric["smells"]
    for category, spec in smells.items():
        if spec["pattern_type"] == "dictionary":
            entries = spec.get("words") or spec.get("phrases")
            assert entries and len(entries) >= 1, (
                f"smell category {category} has empty dictionary"
            )
        elif spec["pattern_type"] == "regex":
            assert "pattern" in spec and spec["pattern"], (
                f"smell category {category} missing regex pattern"
            )


def test_rubric_detector_names_documented(skill_root: Path) -> None:
    """Each node references a detector by name — must be in expected set for M2."""
    rubric = _load_rubric(skill_root)
    expected_detectors = {
        "coverage_matrix",
        "adr_completeness",
        "tdd_in_bugfix",
        "spec_smells",
    }
    found = {node["detector"] for node in rubric["nodes"]}
    assert found == expected_detectors, (
        f"detectors found {found}, expected {expected_detectors}"
    )


def test_rubric_has_how_to_evolve_section(skill_root: Path) -> None:
    content = (skill_root / "templates" / "rubric-v1.md").read_text(encoding="utf-8")
    content_lower = content.lower()
    assert "how to evolve" in content_lower or "evolution" in content_lower
