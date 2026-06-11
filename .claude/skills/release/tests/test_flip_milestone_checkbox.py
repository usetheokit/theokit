"""Tests for flip_milestone_checkbox.py."""
from __future__ import annotations

import subprocess
from pathlib import Path

from flip_milestone_checkbox import flip


def test_flips_unchecked_milestone(roadmap_pre_flip: Path) -> None:
    text = roadmap_pre_flip.read_text(encoding="utf-8")
    new_text, status = flip(text, "M2")
    assert status == "flipped"
    assert "### M2 — [x] Streaming" in new_text
    # Untouched milestones keep their state
    assert "### M0 — [x] Skeleton" in new_text
    assert "### M3 — [ ] Quotas" in new_text


def test_idempotent_when_already_x(roadmap_pre_flip: Path) -> None:
    text = roadmap_pre_flip.read_text(encoding="utf-8")
    new_text, status = flip(text, "M0")
    assert status == "already-x"
    assert new_text == text


def test_returns_not_found_for_missing_milestone(roadmap_pre_flip: Path) -> None:
    text = roadmap_pre_flip.read_text(encoding="utf-8")
    new_text, status = flip(text, "M99")
    assert status == "not-found"
    assert new_text == text


def test_only_targets_requested_milestone(roadmap_pre_flip: Path) -> None:
    """M2 flip MUST NOT touch M3 — both are [ ] before."""
    text = roadmap_pre_flip.read_text(encoding="utf-8")
    new_text, status = flip(text, "M2")
    assert status == "flipped"
    assert new_text.count("### M3 — [ ]") == 1  # M3 stays unchecked


def test_multi_flip_invariant_triggers_on_duplicate_header(tmp_path: Path) -> None:
    """If ROADMAP.md somehow has two `### M2 — [ ] ...` headers, abort."""
    body = (
        "### M2 — [ ] First duplicate\n\n**Objective:** a.\n\n"
        "**Definition of done:**\n\n- [ ] x.\n\n**Dependencies:** none.\n\n---\n\n"
        "### M2 — [ ] Second duplicate\n\n**Objective:** b.\n\n"
        "**Definition of done:**\n\n- [ ] y.\n\n**Dependencies:** none.\n\n---\n\n"
    )
    new_text, status = flip(body, "M2")
    assert status == "multi-flip"
    assert new_text == body


def test_cli_runs_against_real_file(roadmap_pre_flip: Path, tmp_path: Path) -> None:
    """End-to-end via CLI; --commit OFF (no git side effect)."""
    script = Path(__file__).parent.parent / "scripts" / "flip_milestone_checkbox.py"
    runs_dir = tmp_path / "roadmap-runs"
    result = subprocess.run(
        [
            "python3", str(script),
            "--roadmap", str(roadmap_pre_flip),
            "--milestone-id", "M2",
            "--version", "0.5.0",
            "--roadmap-runs-dir", str(runs_dir),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "FLIPPED M2" in result.stdout
    assert "### M2 — [x] Streaming" in roadmap_pre_flip.read_text(encoding="utf-8")
    # Audit file created
    run_files = list(runs_dir.glob("M2-*.md"))
    assert len(run_files) == 1
    audit_content = run_files[0].read_text(encoding="utf-8")
    assert "milestone_id: M2" in audit_content
    assert "status: completed" in audit_content


def test_cli_returncode_1_on_multi_flip(tmp_path: Path) -> None:
    """CLI exits 1 when invariant violated."""
    bad_roadmap = tmp_path / "bad.md"
    bad_roadmap.write_text(
        "### M2 — [ ] One\n\n**Definition of done:**\n\n- [ ] a.\n\n---\n\n"
        "### M2 — [ ] Two\n\n**Definition of done:**\n\n- [ ] b.\n\n---\n\n",
        encoding="utf-8",
    )
    script = Path(__file__).parent.parent / "scripts" / "flip_milestone_checkbox.py"
    result = subprocess.run(
        ["python3", str(script), "--roadmap", str(bad_roadmap), "--milestone-id", "M2", "--version", "0.1.0"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert "single-flip invariant" in result.stderr


def test_cli_returncode_2_on_invalid_milestone_id(roadmap_pre_flip: Path) -> None:
    script = Path(__file__).parent.parent / "scripts" / "flip_milestone_checkbox.py"
    result = subprocess.run(
        ["python3", str(script), "--roadmap", str(roadmap_pre_flip), "--milestone-id", "not-valid", "--version", "0.1.0"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert "invalid milestone_id" in result.stderr
