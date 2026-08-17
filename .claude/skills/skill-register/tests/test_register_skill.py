"""Tests for register_skill.py — verifies promotion + refusal logic."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "scripts" / "register_skill.py"


def _run(candidate: str, project_root: Path, dry_run: bool = False) -> tuple[int, dict]:
    args = [sys.executable, str(SCRIPT), "--candidate", candidate]
    if dry_run:
        args.append("--dry-run")
    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        cwd=str(project_root),
    )
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        try:
            data = json.loads(result.stderr)
        except json.JSONDecodeError:
            data = {"raw": result.stdout, "stderr": result.stderr}
    return result.returncode, data


def test_dry_run_good_candidate(isolated_project: Path, good_candidate: str) -> None:
    rc, data = _run(good_candidate, isolated_project, dry_run=True)
    assert rc == 0
    assert data.get("dry_run") is True
    assert data.get("validator_verdict") == "PASS"
    # No move should have happened
    target = isolated_project / ".claude" / "skills" / good_candidate
    assert not target.exists()


def test_refuses_bad_candidate(isolated_project: Path, bad_candidate: str) -> None:
    rc, data = _run(bad_candidate, isolated_project, dry_run=True)
    assert rc == 1
    # Either validator rejected or candidate has no .source-blueprint OR fabricated citation
    assert "Refused" in str(data.get("error", "")) or data.get("validator_verdict") in ("REJECT", "NEEDS_REVIEW")
