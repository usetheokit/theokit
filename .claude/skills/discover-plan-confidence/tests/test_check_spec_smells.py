"""Tests for check_spec_smells.py — verifies smell detection on discovery plan prose.

RED tests of T0.5. MUST fail with ModuleNotFoundError until T1.4 lands the
check_spec_smells module + _rubric_loader (both copy-with-attribution from sibling).

Uses a tmp_path-based minimal rubric so tests are self-contained — T3.2's
real rubric at templates/rubric-discover-plan.md is not yet required.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from check_spec_smells import check_spec_smells  # noqa: E402


MINIMAL_RUBRIC_YAML = """
# Minimal rubric for check_spec_smells unit tests

```yaml
version: 1
artifact_type: discovery_plan
nodes:
  - id: 1
    dimension: structural_risk
    detector: spec_smells
    failure_action: penalty
    penalty_weights:
      subjective_adjectives: -2
      weak_imperatives: -3
      vague_pronouns: -2
      loopholes: -3
      non_verifiable: -4
    weight: 1.0
smells:
  subjective_adjectives:
    pattern_type: dictionary
    words:
      - fast
      - efficient
      - robust
  weak_imperatives:
    pattern_type: regex
    pattern: '\\b(should|could|may|might)\\b'
  vague_pronouns:
    pattern_type: regex
    pattern: '(^|\\. )(This|That|These|Those)\\b'
  loopholes:
    pattern_type: dictionary
    phrases:
      - "if possible"
      - "as appropriate"
  non_verifiable:
    pattern_type: dictionary
    words:
      - user-friendly
      - maintainable
```
"""


@pytest.fixture
def minimal_rubric(tmp_path: Path) -> Path:
    rubric = tmp_path / "rubric.md"
    rubric.write_text(MINIMAL_RUBRIC_YAML, encoding="utf-8")
    return rubric


def _build_plan(tmp_path: Path, name: str, body: str) -> Path:
    plan = tmp_path / name
    plan.write_text(body, encoding="utf-8")
    return plan


def test_smell_detection_in_prose(tmp_path: Path, minimal_rubric: Path) -> None:
    """Text 'fast and efficient' has 2 subjective_adjective hits."""
    plan = _build_plan(tmp_path, "smelly.md", "The system is fast and efficient under load.\n")
    report = check_spec_smells(plan, minimal_rubric)
    assert report.by_category.get("subjective_adjectives", 0) == 2
    assert report.total_hits >= 2


def test_smells_in_code_fence_ignored(tmp_path: Path, minimal_rubric: Path) -> None:
    """Smells inside fenced code blocks MUST NOT be counted (they are examples, not prose)."""
    body = "Some prose.\n\n```\nfast efficient robust\n```\n\nMore prose.\n"
    plan = _build_plan(tmp_path, "fenced.md", body)
    report = check_spec_smells(plan, minimal_rubric)
    assert report.by_category.get("subjective_adjectives", 0) == 0


def test_loophole_phrase_detected(tmp_path: Path, minimal_rubric: Path) -> None:
    """Phrase 'if possible' triggers loopholes category."""
    plan = _build_plan(tmp_path, "loop.md", "We will validate inputs if possible.\n")
    report = check_spec_smells(plan, minimal_rubric)
    assert report.by_category.get("loopholes", 0) >= 1


def test_total_penalty_negative_when_hits(tmp_path: Path, minimal_rubric: Path) -> None:
    """Any positive hit count produces negative total_penalty per rubric weights."""
    plan = _build_plan(tmp_path, "hits.md", "The system should be fast.\n")
    report = check_spec_smells(plan, minimal_rubric)
    assert report.total_hits > 0
    assert report.total_penalty < 0


def test_zero_hits_returns_zero_penalty(tmp_path: Path, minimal_rubric: Path) -> None:
    """Clean prose without any dictionary word or regex match returns zero penalty."""
    plan = _build_plan(tmp_path, "clean.md", "The component validates inputs at the boundary.\n")
    report = check_spec_smells(plan, minimal_rubric)
    assert report.total_hits == 0
    assert report.total_penalty == 0
