"""Tests for inject_milestone_id.py."""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from inject_milestone_id import inject


def _split_meta(text: str) -> dict:
    return yaml.safe_load(text.split("---", 2)[1])


def test_adds_when_frontmatter_missing() -> None:
    plan = "# My Plan\n\nBody here.\n"
    new, status = inject(plan, "M3")
    assert status == "no-frontmatter"
    assert _split_meta(new)["milestone_id"] == "M3"
    assert "# My Plan" in new


def test_adds_when_frontmatter_present_but_no_milestone() -> None:
    plan = '---\nslug: foo\ncreated: "2026-06-07"\n---\n\n# Plan\n'
    new, status = inject(plan, "M3")
    assert status == "added"
    meta = _split_meta(new)
    assert meta["milestone_id"] == "M3"
    assert meta["slug"] == "foo"  # Preserves other fields
    assert meta["created"] == "2026-06-07"


def test_idempotent_when_already_matches() -> None:
    plan = "---\nslug: foo\nmilestone_id: M3\n---\n\n# Plan\n"
    new, status = inject(plan, "M3")
    assert status == "matched"
    assert new == plan  # Unchanged


def test_refuses_when_conflicting_milestone_set() -> None:
    plan = "---\nslug: foo\nmilestone_id: M2\n---\n\n# Plan\n"
    new, status = inject(plan, "M3")
    assert status == "conflict:M2"
    assert new == plan


def test_rejects_invalid_milestone_id_format() -> None:
    plan = "---\nslug: foo\n---\nbody\n"
    with pytest.raises(ValueError, match="invalid milestone_id"):
        inject(plan, "milestone-3")
    with pytest.raises(ValueError):
        inject(plan, "3")
    with pytest.raises(ValueError):
        inject(plan, "")


def test_writes_to_file_when_invoked_via_main(tmp_path: Path) -> None:
    """End-to-end via CLI shape."""
    import subprocess

    plan_path = tmp_path / "test-plan.md"
    plan_path.write_text("---\nslug: foo\n---\n\n# Plan\n", encoding="utf-8")

    script = Path(__file__).parent.parent / "scripts" / "inject_milestone_id.py"
    result = subprocess.run(
        ["python3", str(script), "--plan", str(plan_path), "--milestone-id", "M7"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "injected" in result.stdout
    assert _split_meta(plan_path.read_text(encoding="utf-8"))["milestone_id"] == "M7"
