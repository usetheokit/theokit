"""Tests for consolidate_findings.py — verifies severity classification + verdict logic."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "scripts" / "consolidate_findings.py"


def _write_findings(findings_dir: Path, name: str, findings: list[dict]) -> Path:
    import yaml
    findings_dir.mkdir(parents=True, exist_ok=True)
    path = findings_dir / f"{name}.yml"
    path.write_text(yaml.safe_dump({"agent": name, "findings": findings}), encoding="utf-8")
    return path


def _run(findings_dir: Path, output: Path, coverage: float | None = None) -> tuple[int, dict]:
    args = [
        sys.executable,
        str(SCRIPT),
        "--findings-dir", str(findings_dir),
        "--output", str(output),
    ]
    if coverage is not None:
        args.extend(["--edge-case-coverage-ratio", str(coverage)])
    result = subprocess.run(args, capture_output=True, text=True)
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = {"raw": result.stdout, "stderr": result.stderr}
    return result.returncode, data


def test_no_findings_ready_to_merge(tmp_path: Path) -> None:
    findings_dir = tmp_path / "findings"
    _write_findings(findings_dir, "test-arch", [])
    output = tmp_path / "report.md"
    rc, data = _run(findings_dir, output, coverage=1.0)
    assert rc == 0
    assert data["verdict"] == "READY_TO_MERGE"


def test_blocker_needs_fixes(tmp_path: Path) -> None:
    findings_dir = tmp_path / "findings"
    _write_findings(findings_dir, "test-arch", [
        {"id": "F-1", "severity": "BLOCKER", "summary": "blocking issue", "file": "src/x.ts"}
    ])
    output = tmp_path / "report.md"
    rc, data = _run(findings_dir, output)
    assert rc == 1
    assert data["verdict"] == "NEEDS_FIXES"
    assert data["findings_by_severity"]["BLOCKER"] == 1


def test_three_high_needs_fixes(tmp_path: Path) -> None:
    """Per rules/cycle-review.md: > 2 HIGH findings → NEEDS_FIXES."""
    findings_dir = tmp_path / "findings"
    _write_findings(findings_dir, "test-tests", [
        {"id": "F-1", "severity": "HIGH", "summary": "high issue 1", "file": "src/a.ts"},
        {"id": "F-2", "severity": "HIGH", "summary": "high issue 2", "file": "src/b.ts"},
        {"id": "F-3", "severity": "HIGH", "summary": "high issue 3", "file": "src/c.ts"},
    ])
    output = tmp_path / "report.md"
    rc, data = _run(findings_dir, output)
    assert rc == 1
    assert data["verdict"] == "NEEDS_FIXES"


def test_legacy_critical_token_maps_to_high(tmp_path: Path) -> None:
    """Back-compat: legacy CRITICAL token from older agents is aliased to HIGH."""
    findings_dir = tmp_path / "findings"
    _write_findings(findings_dir, "test-tests", [
        {"id": "F-1", "severity": "CRITICAL", "summary": "legacy critical", "file": "src/x.ts"}
    ])
    output = tmp_path / "report.md"
    rc, data = _run(findings_dir, output)
    # Single HIGH alone is READY_TO_MERGE (≤ 2 HIGH with mitigation per rule)
    assert rc == 0
    assert data["verdict"] == "READY_TO_MERGE"
    assert data["findings_by_severity"]["HIGH"] == 1
    assert data["findings_by_severity"].get("CRITICAL", 0) == 0


def test_two_high_ready_to_merge(tmp_path: Path) -> None:
    """≤ 2 HIGH with documented mitigation → READY_TO_MERGE."""
    findings_dir = tmp_path / "findings"
    _write_findings(findings_dir, "test-arch", [
        {"id": "F-1", "severity": "HIGH", "summary": "high 1", "file": "src/a.ts"},
        {"id": "F-2", "severity": "HIGH", "summary": "high 2", "file": "src/b.ts"},
    ])
    output = tmp_path / "report.md"
    rc, data = _run(findings_dir, output, coverage=1.0)
    assert rc == 0
    assert data["verdict"] == "READY_TO_MERGE"


def test_low_coverage_needs_deeper(tmp_path: Path) -> None:
    findings_dir = tmp_path / "findings"
    _write_findings(findings_dir, "test-arch", [])
    output = tmp_path / "report.md"
    rc, data = _run(findings_dir, output, coverage=0.5)
    assert rc == 3
    assert data["verdict"] == "NEEDS_DEEPER"


def test_report_markdown_written(tmp_path: Path) -> None:
    findings_dir = tmp_path / "findings"
    _write_findings(findings_dir, "test-arch", [
        {"id": "F-1", "severity": "LOW", "summary": "small issue"}
    ])
    output = tmp_path / "report.md"
    rc, data = _run(findings_dir, output)
    assert output.exists()
    content = output.read_text(encoding="utf-8")
    assert "LOW" in content
    assert "F-1" in content
