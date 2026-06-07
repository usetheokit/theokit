"""Tests for validate_skill.py — verifies 5 deterministic checks."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "scripts" / "validate_skill.py"


def _run(skill_md: Path) -> tuple[int, dict]:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(skill_md)],
        capture_output=True,
        text=True,
    )
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = {"raw": result.stdout, "stderr": result.stderr}
    return result.returncode, data


def test_good_skill_passes(good_skill: Path) -> None:
    rc, data = _run(good_skill)
    assert rc == 0
    assert data["verdict"] == "PASS"
    assert data["checks"]["frontmatter_conformance"]["status"] == "PASS"
    assert data["checks"]["no_forbidden_patterns"]["status"] == "PASS"


def test_fabricated_citation_rejected(bad_fabricated_citation_skill: Path) -> None:
    rc, data = _run(bad_fabricated_citation_skill)
    assert rc == 1
    assert data["verdict"] == "REJECT"
    assert data["checks"]["citation_existence"]["status"] == "FAIL"


def test_bash_perm_rejected(bad_bash_perm_skill: Path) -> None:
    rc, data = _run(bad_bash_perm_skill)
    assert rc == 1
    assert data["verdict"] == "REJECT"
    # Frontmatter check rejects Bash() perm
    assert data["checks"]["frontmatter_conformance"]["status"] == "FAIL"


def test_missing_frontmatter_rejected(tmp_path: Path) -> None:
    skill_md = tmp_path / "no-fm.md"
    skill_md.write_text("# Body without frontmatter\n", encoding="utf-8")
    rc, data = _run(skill_md)
    assert rc == 1
    assert data["verdict"] == "REJECT"


def test_weak_description_needs_review(tmp_path: Path) -> None:
    """Description with <2 'Use when' phrases → NEEDS_REVIEW (WARN)."""
    skill_md = tmp_path / "weak.md"
    skill_md.write_text(
        "---\n"
        "name: weak-patterns\n"
        "description: Some patterns for stuff.\n"
        "user-invocable: true\n"
        "allowed-tools: Read Glob Grep\n"
        "generated-from-blueprint: fake\n"
        "generated-at: 2026-05-21\n"
        "---\n\n"
        "# Weak\n",
        encoding="utf-8",
    )
    rc, data = _run(skill_md)
    assert rc == 3  # NEEDS_REVIEW
    assert data["verdict"] == "NEEDS_REVIEW"
