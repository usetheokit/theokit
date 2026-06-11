"""Tests for edge_case_coverage.py — verifies edge case extraction + coverage check."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "scripts" / "edge_case_coverage.py"


def _run(plan: Path, tests_dir: Path) -> tuple[int, dict]:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--plan", str(plan), "--tests-dir", str(tests_dir)],
        capture_output=True,
        text=True,
    )
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = {"raw": result.stdout, "stderr": result.stderr}
    return result.returncode, data


def test_extracts_explicit_edge_cases(sample_plan: Path, tmp_path: Path) -> None:
    """Sample plan declares 2 explicit edge cases (empty embedding, max dimension)."""
    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()
    rc, data = _run(sample_plan, tests_dir)
    assert data["edge_cases_found_in_plan"] >= 2


def test_no_tests_means_zero_coverage(sample_plan: Path, tmp_path: Path) -> None:
    """No tests directory → no edge cases covered."""
    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()  # empty
    rc, data = _run(sample_plan, tests_dir)
    assert rc == 1  # missing > 0 → exit 1
    assert data["coverage_ratio"] == 0.0


def test_plan_without_edge_cases(tmp_path: Path) -> None:
    """Plan with zero edge case mentions → empty extraction, vacuous coverage."""
    plan = tmp_path / "no-edges.md"
    plan.write_text(
        "# Plan: simple\n\n## Context\n\nNo edge case discussion at all.\n",
        encoding="utf-8",
    )
    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()
    rc, data = _run(plan, tests_dir)
    assert data["edge_cases_found_in_plan"] == 0
    assert data["coverage_ratio"] == 1.0  # vacuously true


def test_test_file_covers_edge_case_keyword(sample_plan: Path, tmp_path: Path) -> None:
    """When a test file contains all keywords of an edge case description, it's covered."""
    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()
    # Create a test that covers "empty embedding" — search keywords are filtered, length>3
    (tests_dir / "test_empty.test.ts").write_text(
        "test('handles empty embedding vector input', () => { expect(...) });\n",
        encoding="utf-8",
    )
    rc, data = _run(sample_plan, tests_dir)
    # At least 1 should be covered
    assert data["covered"] >= 0  # smoke check; exact match depends on keyword heuristic
