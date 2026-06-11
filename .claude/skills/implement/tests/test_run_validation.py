"""Tests for run_validation.py — verifies graceful pre-code SKIP + integration."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "scripts" / "run_validation.py"


def _run_validation(slug: str, project_root: Path) -> tuple[int, dict]:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), slug, "--project-root", str(project_root), "--no-write-report"],
        capture_output=True,
        text=True,
    )
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = {"raw": result.stdout, "stderr": result.stderr}
    return result.returncode, data


def test_pre_code_phase_all_skip(fake_project: Path) -> None:
    """No package.json → all npm-based gates SKIP gracefully; overall=PARTIAL."""
    rc, data = _run_validation("test-slug", fake_project)
    assert rc == 0  # PARTIAL is exit 0 (no failures, just skips)
    assert data["overall_status"] == "PARTIAL"
    skips = [c for c in data["checks"] if c.get("status") == "SKIP"]
    assert len(skips) >= 4


def test_with_package_json_and_passing_scripts(fake_project: Path) -> None:
    """Package.json with test/typecheck/lint that exit 0 → all PASS (or some SKIP)."""
    (fake_project / "package.json").write_text(
        json.dumps({
            "name": "fake",
            "scripts": {
                "test": "true",  # exit 0
                "typecheck": "true",
                "lint": "true",
            }
        }),
        encoding="utf-8",
    )
    rc, data = _run_validation("test-slug", fake_project)
    # No FAILs expected; PASS or SKIP only
    fails = [c for c in data["checks"] if c.get("status") == "FAIL"]
    assert len(fails) == 0


def test_with_failing_test_script(fake_project: Path) -> None:
    """Package.json with `test` that exits 1 → npm test FAIL → overall=FAIL."""
    (fake_project / "package.json").write_text(
        json.dumps({
            "name": "fake",
            "scripts": {
                "test": "false",  # exit 1
            }
        }),
        encoding="utf-8",
    )
    rc, data = _run_validation("test-slug", fake_project)
    assert rc == 1
    assert data["overall_status"] == "FAIL"
    test_check = next(c for c in data["checks"] if c.get("name") == "npm test")
    assert test_check["status"] == "FAIL"
