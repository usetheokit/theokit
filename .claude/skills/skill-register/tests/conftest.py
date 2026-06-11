"""Shared pytest fixtures for skill-register tests."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).parent.parent
SCRIPTS_DIR = SKILL_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))


@pytest.fixture
def isolated_project(tmp_path: Path) -> Path:
    """Create an isolated mini-project that mimics the .claude/ layout for tests."""
    root = tmp_path / "mini-project"
    root.mkdir()
    (root / ".git").mkdir()
    claude = root / ".claude"
    (claude / "skills" / "generated").mkdir(parents=True)
    (claude / "skills" / "skill-validator" / "scripts").mkdir(parents=True)
    (claude / "knowledge-base" / "reviews").mkdir(parents=True)

    # Copy a real validate_skill.py into the mini-project so the register script can find it
    real_validator = Path(__file__).parent.parent.parent / "skill-validator" / "scripts" / "validate_skill.py"
    mini_validator = claude / "skills" / "skill-validator" / "scripts" / "validate_skill.py"
    if real_validator.exists():
        mini_validator.write_text(real_validator.read_text(encoding="utf-8-sig"), encoding="utf-8")
    return root


@pytest.fixture
def good_candidate(isolated_project: Path) -> str:
    """Create a candidate skill that should PASS validator."""
    candidate_dir = isolated_project / ".claude" / "skills" / "generated" / "test-good-patterns"
    candidate_dir.mkdir(parents=True)
    (candidate_dir / "SKILL.md").write_text(
        "---\n"
        "name: test-good-patterns\n"
        "description: Patterns for testing. Use when planning src/local/, when designing schema, or when wiring pgvector.\n"
        "user-invocable: true\n"
        "allowed-tools: Read Glob Grep\n"
        "generated-from-blueprint: test-blueprint\n"
        "generated-at: 2026-05-21\n"
        "---\n\n"
        "# Test Patterns\n\n## Patterns\n\n### Pattern 1\n\nNo issues here.\n",
        encoding="utf-8",
    )
    (candidate_dir / ".source-blueprint").write_text(
        "test-blueprint\nSHIPPABLE_WITH_CAVEATS\n75.0\n2026-05-21T00:00:00+00:00\n",
        encoding="utf-8",
    )
    return "test-good-patterns"


@pytest.fixture
def bad_candidate(isolated_project: Path) -> str:
    """Create a candidate skill that should be REJECTed (fabricated citation)."""
    candidate_dir = isolated_project / ".claude" / "skills" / "generated" / "test-bad-patterns"
    candidate_dir.mkdir(parents=True)
    (candidate_dir / "SKILL.md").write_text(
        "---\n"
        "name: test-bad-patterns\n"
        "description: Use when bad, when worse.\n"
        "user-invocable: true\n"
        "allowed-tools: Read Glob Grep\n"
        "generated-from-blueprint: fake\n"
        "generated-at: 2026-05-21\n"
        "---\n\n"
        "# Bad\n\n`.claude/knowledge-base/references/project-a/never-exists-anywhere-xyz.py:1`\n",
        encoding="utf-8",
    )
    return "test-bad-patterns"
