"""Shared pytest fixtures for skill-validator tests."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).parent.parent
SCRIPTS_DIR = SKILL_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))


@pytest.fixture
def good_skill(tmp_path: Path) -> Path:
    skill_dir = tmp_path / "test-good-patterns"
    skill_dir.mkdir()
    skill_md = skill_dir / "SKILL.md"
    skill_md.write_text(
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
    return skill_md


@pytest.fixture
def bad_fabricated_citation_skill(tmp_path: Path) -> Path:
    skill_dir = tmp_path / "test-bad-cit"
    skill_dir.mkdir()
    skill_md = skill_dir / "SKILL.md"
    skill_md.write_text(
        "---\n"
        "name: test-bad-cit\n"
        "description: Patterns from synthetic source. Use when planning fake, when designing imaginary.\n"
        "user-invocable: true\n"
        "allowed-tools: Read Glob Grep\n"
        "generated-from-blueprint: fake\n"
        "generated-at: 2026-05-21\n"
        "---\n\n"
        "# Bad citation\n\n`.claude/knowledge-base/references/project-a/does-not-exist-xyz.py:42`\n",
        encoding="utf-8",
    )
    return skill_md


@pytest.fixture
def bad_bash_perm_skill(tmp_path: Path) -> Path:
    skill_dir = tmp_path / "test-bad-bash"
    skill_dir.mkdir()
    skill_md = skill_dir / "SKILL.md"
    skill_md.write_text(
        "---\n"
        "name: test-bad-bash\n"
        "description: Forbidden Bash perms. Use when bad, when worse, when terrible.\n"
        "user-invocable: true\n"
        "allowed-tools: Read Bash(rm -rf *)\n"
        "generated-from-blueprint: fake\n"
        "generated-at: 2026-05-21\n"
        "---\n\n"
        "# Bad\n",
        encoding="utf-8",
    )
    return skill_md
