"""Tests for check_spec_smells.py — verifies smell-detection rubric is applied."""
from __future__ import annotations

from pathlib import Path

import pytest

from check_spec_smells import SmellReport, check_spec_smells  # noqa: E402


def test_clean_blueprint_zero_smells(good_blueprint: Path, rubric_path: Path) -> None:
    report = check_spec_smells(good_blueprint, rubric_path)
    assert isinstance(report, SmellReport)
    # Good blueprint may have a few INFO-level smells but penalty should be modest
    assert report.total_penalty >= -30


def test_smelly_blueprint_detects_weak_imperatives(tmp_path: Path, rubric_path: Path) -> None:
    bp = tmp_path / "smelly.md"
    bp.write_text(
        "# Blueprint: Smelly\n\n"
        "We should add a test if possible. The module could be better. We may consider improvements.\n"
        "Talvez seja eficiente. The system might be robust.\n",
        encoding="utf-8",
    )
    report = check_spec_smells(bp, rubric_path)
    # Should detect: "should", "could", "may", "might", "if possible", "talvez", "eficiente"
    assert report.total_hits >= 5
    assert report.total_penalty < 0
    assert "weak_imperatives" in report.by_category


def test_code_blocks_excluded_from_smells(tmp_path: Path, rubric_path: Path) -> None:
    bp = tmp_path / "code-blocks.md"
    bp.write_text(
        "# Blueprint\n\n"
        "Real prose has no smells here.\n\n"
        "```typescript\n"
        "// This code may contain weak imperatives but should not count\n"
        "if (something) { console.log('could happen'); }\n"
        "```\n",
        encoding="utf-8",
    )
    report = check_spec_smells(bp, rubric_path)
    # The smells inside the code block should be stripped
    weak_count = report.by_category.get("weak_imperatives", 0)
    assert weak_count == 0
