"""Verify the SKILL.md of each chain step INSTRUCTS the agent to READ .claude/rules/."""
from __future__ import annotations

from pathlib import Path

SKILLS_DIR = Path(__file__).parent.parent.parent.parent / "skills"


def _read(skill_name: str) -> str:
    return (SKILLS_DIR / skill_name / "SKILL.md").read_text(encoding="utf-8")


def test_to_plan_instructs_reading_rules() -> None:
    content = _read("to-plan")
    text_lower = content.lower()
    assert ".claude/rules/" in content or ".claude/rules" in content
    assert "step 0" in text_lower
    # Must say "MANDATORY" in connection with rules
    pos_rules = text_lower.find(".claude/rules")
    surrounding = text_lower[max(0, pos_rules - 200) : pos_rules + 500]
    assert "mandatory" in surrounding or "shall" in surrounding


def test_to_plan_mentions_defaults_fallback() -> None:
    content = _read("to-plan")
    text_lower = content.lower()
    assert "defaults" in text_lower
    # Fallback mentions: solid, dry, clean code, loc
    assert "solid" in text_lower
    assert "dry" in text_lower
    assert "clean code" in text_lower or "clean-code" in text_lower
    assert "loc" in text_lower or "lines" in text_lower or "500" in content


def test_plan_confidence_documents_compliance_check() -> None:
    content = _read("plan-confidence")
    text_lower = content.lower()
    assert "architecture compliance" in text_lower or "compliance" in text_lower
    assert ".claude/rules" in content
    assert "fallback" in text_lower
    assert "compliance_score" in content


def test_plan_improve_prompt_mentions_rules() -> None:
    prompt_path = SKILLS_DIR / "plan-improve" / "prompts" / "improvement-prompt.md"
    content = prompt_path.read_text(encoding="utf-8")
    text_lower = content.lower()
    assert ".claude/rules" in content
    assert "step 0" in text_lower
    # The prompt should tell the LLM to respect rules during edits
    assert "respect" in text_lower or "compatible with" in text_lower or "shall" in text_lower


def test_plan_improve_prompt_mentions_defaults_fallback() -> None:
    prompt_path = SKILLS_DIR / "plan-improve" / "prompts" / "improvement-prompt.md"
    content = prompt_path.read_text(encoding="utf-8")
    text_lower = content.lower()
    assert "defaults" in text_lower
    assert "solid" in text_lower or "dry" in text_lower


def test_defaults_bundle_exists() -> None:
    defaults_dir = SKILLS_DIR / "plan-confidence" / "defaults"
    assert defaults_dir.exists()
    expected_files = ["solid.md", "dry.md", "clean-code.md", "loc-limits.md", "testing.md", "README.md"]
    for name in expected_files:
        assert (defaults_dir / name).exists(), f"missing default: {name}"


def test_defaults_marked_as_fallback_only() -> None:
    """Each default doc says it's FALLBACK and project rules win."""
    defaults_dir = SKILLS_DIR / "plan-confidence" / "defaults"
    for md in defaults_dir.glob("*.md"):
        content = md.read_text(encoding="utf-8")
        if md.name == "README.md":
            assert "fallback" in content.lower()
            continue
        # Each principle doc should mark itself as fallback
        assert "fallback" in content.lower() or "default" in content.lower(), (
            f"{md.name} doesn't mark itself as fallback"
        )
