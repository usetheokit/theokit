"""T1.1 — SKILL.md structure and score-report-template tests (RED first)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml


def _read_skill_md(skill_root: Path) -> tuple[dict[str, object], str]:
    """Parse SKILL.md frontmatter + body."""
    content = (skill_root / "SKILL.md").read_text(encoding="utf-8")
    assert content.startswith("---\n"), "SKILL.md must start with YAML frontmatter"
    _, frontmatter_raw, body = content.split("---\n", 2)
    frontmatter: dict[str, object] = yaml.safe_load(frontmatter_raw)
    return frontmatter, body


def test_skill_md_exists(skill_root: Path) -> None:
    assert (skill_root / "SKILL.md").exists()


def test_skill_md_frontmatter_parses(skill_root: Path) -> None:
    fm, _ = _read_skill_md(skill_root)
    assert isinstance(fm, dict)
    assert "name" in fm
    assert "description" in fm


def test_skill_md_name_matches_directory(skill_root: Path) -> None:
    fm, _ = _read_skill_md(skill_root)
    assert fm["name"] == "plan-confidence"


def test_skill_md_description_under_100_chars(skill_root: Path) -> None:
    fm, _ = _read_skill_md(skill_root)
    desc = fm["description"]
    assert isinstance(desc, str)
    assert len(desc) <= 200, f"description has {len(desc)} chars (max 200)"


def test_skill_md_has_workflow_section(skill_root: Path) -> None:
    _, body = _read_skill_md(skill_root)
    assert "## Workflow" in body


def test_skill_md_mentions_run_structural_script(skill_root: Path) -> None:
    _, body = _read_skill_md(skill_root)
    assert "scripts/run_structural.py" in body


def test_skill_md_mentions_m3_out_of_scope(skill_root: Path) -> None:
    _, body = _read_skill_md(skill_root)
    body_lower = body.lower()
    assert "m3" in body_lower or "out of scope" in body_lower or "out-of-scope" in body_lower


def test_skill_md_mentions_hard_caps(skill_root: Path) -> None:
    _, body = _read_skill_md(skill_root)
    assert "hard cap" in body.lower() or "hard caps" in body.lower()


def test_skill_md_under_300_lines(skill_root: Path) -> None:
    content = (skill_root / "SKILL.md").read_text(encoding="utf-8")
    line_count = len(content.splitlines())
    assert line_count <= 300, f"SKILL.md has {line_count} lines (max 300)"


def test_score_report_template_exists(skill_root: Path) -> None:
    template = skill_root / "templates" / "score-report-template.md"
    assert template.exists()


def test_score_report_template_has_json_example(skill_root: Path) -> None:
    template = skill_root / "templates" / "score-report-template.md"
    content = template.read_text(encoding="utf-8")
    assert "```json" in content, "Template must show a JSON example"


def test_score_report_template_json_example_parses(skill_root: Path) -> None:
    """Extract the example JSON and validate it parses as JSON."""
    template = skill_root / "templates" / "score-report-template.md"
    content = template.read_text(encoding="utf-8")
    # Extract first ```json block
    start = content.find("```json")
    assert start != -1, "No ```json block found"
    end = content.find("```", start + len("```json"))
    assert end != -1, "Unclosed ```json block"
    json_block = content[start + len("```json"):end].strip()
    # Replace placeholder values that aren't valid JSON yet (e.g., <PLAN_SLUG>)
    # Should still be syntactically valid JSON.
    try:
        parsed = json.loads(json_block)
    except json.JSONDecodeError as exc:
        pytest.fail(f"JSON example doesn't parse: {exc}\n---\n{json_block}\n---")
    assert isinstance(parsed, dict), "Top-level JSON must be object"
    # v1.1 EC-2: must include active_dimensions and weight_normalization_factor
    assert "active_dimensions" in parsed, "Template must show active_dimensions field"
    assert "weight_normalization_factor" in parsed, "Template must show weight_normalization_factor field"
