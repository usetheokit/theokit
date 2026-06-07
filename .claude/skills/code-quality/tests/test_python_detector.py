"""T1.1 — PythonDetector.detect_dead_code (vulture wrapper) tests.

Per plan v1.3 § T1.1 TDD section: 4 RED tests covering positive/negative
fixture cases plus auditor_unavailable handling plus min-confidence threshold.
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from scripts.detectors.python import PythonDetector

pytestmark = pytest.mark.python


def test_python_detector_flags_unused_function(fixtures_dir: Path) -> None:
    """Vulture on the positive fixture MUST report ≥ 1 dead-code Finding."""
    detector = PythonDetector(min_confidence=60)
    findings = detector.detect_dead_code(fixtures_dir / "python" / "dead_code_present")
    dead_findings = [f for f in findings if f.detector == "d1_dead_code"]
    assert len(dead_findings) >= 1, (
        f"Expected at least 1 dead-code Finding on positive fixture; got {len(dead_findings)}: "
        f"{[f.message for f in findings]}"
    )


def test_python_detector_no_findings_on_clean_fixture(fixtures_dir: Path) -> None:
    """Clean fixture MUST NOT trigger any dead-code Finding (FP guard)."""
    detector = PythonDetector(min_confidence=80)
    findings = detector.detect_dead_code(fixtures_dir / "python" / "clean")
    dead_findings = [f for f in findings if f.detector == "d1_dead_code"]
    assert dead_findings == [], (
        f"Clean fixture must produce zero dead_code Findings; got: "
        f"{[f.message for f in dead_findings]}"
    )


def test_python_detector_emits_auditor_unavailable_when_vulture_missing(
    tmp_path: Path,
) -> None:
    """When the vulture binary is missing, emit auditor_unavailable_vulture SOFT_CAP."""
    detector = PythonDetector()
    with patch("subprocess.run", side_effect=FileNotFoundError("vulture not found")):
        findings = detector.detect_dead_code(tmp_path)
    assert len(findings) == 1
    assert "auditor_unavailable_vulture" in findings[0].allowlist_key
    assert findings[0].severity == "SOFT_CAP"


def test_python_detector_respects_min_confidence_threshold(fixtures_dir: Path) -> None:
    """Setting min_confidence high enough should drop low-confidence findings."""
    detector_low = PythonDetector(min_confidence=60)
    findings_low = detector_low.detect_dead_code(fixtures_dir / "python" / "dead_code_present")

    detector_max = PythonDetector(min_confidence=100)
    findings_max = detector_max.detect_dead_code(fixtures_dir / "python" / "dead_code_present")

    # Higher confidence floor cannot produce MORE findings than lower floor.
    assert len(findings_max) <= len(findings_low)


def test_python_detector_handles_subprocess_timeout(tmp_path: Path) -> None:
    """Subprocess timeout MUST emit a Finding rather than propagating the exception."""
    detector = PythonDetector()
    timeout = subprocess.TimeoutExpired(cmd=["vulture"], timeout=1)
    with patch("subprocess.run", side_effect=timeout):
        findings = detector.detect_dead_code(tmp_path)
    assert len(findings) == 1
    assert "auditor" in findings[0].allowlist_key
