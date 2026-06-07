"""End-to-end tests for run_blueprint_score.py — verifies scorer integration."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "scripts" / "run_blueprint_score.py"


def _run(blueprint_path: Path, project_root: Path) -> tuple[int, dict]:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(blueprint_path), "--no-warn"],
        capture_output=True,
        text=True,
        cwd=str(project_root),
    )
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = {"raw_stdout": result.stdout, "stderr": result.stderr}
    return result.returncode, data


def test_good_blueprint_scores_shippable(good_blueprint: Path, project_root: Path) -> None:
    rc, data = _run(good_blueprint, project_root)
    assert rc == 0, f"Expected exit 0, got {rc}: {data}"
    assert data["verdict"] == "SHIPPABLE"
    assert data["final_score_after_caps"] >= 90
    assert data["hard_caps_triggered"] == []


def test_blueprint_with_fabricated_citation_invalid(tmp_path: Path, good_blueprint: Path, project_root: Path) -> None:
    # Copy good blueprint and corrupt one citation
    corrupted_dir = project_root / ".claude" / "knowledge-base" / "discoveries" / "blueprints"
    corrupted_dir.mkdir(parents=True, exist_ok=True)
    corrupted = corrupted_dir / "test-fabricated-blueprint.md"
    content = good_blueprint.read_text(encoding="utf-8-sig")
    content += "\n\nBogus citation: .claude/knowledge-base/references/project-a/fake-file-xyz.py:99\n"
    corrupted.write_text(content, encoding="utf-8")

    try:
        rc, data = _run(corrupted, project_root)
        assert rc == 1, f"Expected exit 1 (INVALID), got {rc}: {data}"
        assert data["verdict"] == "INVALID"
        assert "fabricated_citation" in data["hard_caps_triggered"]
        assert data["final_score_after_caps"] <= 49.0
    finally:
        corrupted.unlink(missing_ok=True)


def test_blueprint_missing_corner_invalid(tmp_path: Path, project_root: Path) -> None:
    bp_dir = project_root / ".claude" / "knowledge-base" / "discoveries" / "blueprints"
    bp_dir.mkdir(parents=True, exist_ok=True)
    bp = bp_dir / "test-missing-corner-blueprint.md"
    bp.write_text(
        "# Blueprint: Test\n\n"
        "## Context\n\nText.\n\n"
        "## Objective\n\nText.\n\n"
        # Coverage Corner 1 MISSING
        "## Coverage Corner 2 — Dependencies\n\n### X\n\nReal content here xxxxxxxxx.\n\n"
        "## Coverage Corner 3 — Tools\n\n### X\n\nReal content here xxxxxxxxx.\n\n"
        "## Coverage Corner 4 — Techniques\n\n### X\n\nReal content here xxxxxxxxx.\n\n"
        "## Cross-cutting Comparison\n\nText.\n\n"
        "## ADRs\n\n### D1 — Title\n\nRationale.\n\n"
        "## Recommendations\n\n- Do X\n",
        encoding="utf-8",
    )

    try:
        rc, data = _run(bp, project_root)
        assert rc == 1, f"Expected exit 1 (INVALID), got {rc}"
        assert data["verdict"] == "INVALID"
        assert any("empty_corner_tests" in c for c in data["hard_caps_triggered"])
    finally:
        bp.unlink(missing_ok=True)
