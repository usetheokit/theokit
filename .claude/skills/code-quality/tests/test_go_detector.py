"""T1.4 — GoDetector.detect_dead_code (deadcode wrapper) tests."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from scripts.detectors.go import GoDetector

pytestmark = pytest.mark.go


_DEADCODE_POSITIVE_JSON = json.dumps(
    [
        {"position": "main.go:42:6", "name": "unreachableFunc", "generated": False},
        {"position": "internal/helper.go:7:1", "name": "orphanMethod", "generated": False},
    ]
)

_DEADCODE_CLEAN_JSON = json.dumps([])


def _mock_run(stdout: str, returncode: int = 0):
    class _R:
        def __init__(self) -> None:
            self.stdout = stdout
            self.stderr = ""
            self.returncode = returncode

    return _R()


def test_go_detector_flags_unreachable_function(tmp_path: Path) -> None:
    det = GoDetector()
    with patch("subprocess.run", return_value=_mock_run(_DEADCODE_POSITIVE_JSON, 0)):
        findings = det.detect_dead_code(tmp_path)
    dead = [f for f in findings if f.detector == "d1_dead_code"]
    assert any("unreachableFunc" in f.symbol_or_line for f in dead)
    assert any("orphanMethod" in f.symbol_or_line for f in dead)


def test_go_detector_no_findings_on_clean(tmp_path: Path) -> None:
    det = GoDetector()
    with patch("subprocess.run", return_value=_mock_run(_DEADCODE_CLEAN_JSON, 0)):
        findings = det.detect_dead_code(tmp_path)
    dead = [f for f in findings if f.detector == "d1_dead_code"]
    assert dead == []


def test_go_detector_emits_auditor_unavailable_when_deadcode_missing(tmp_path: Path) -> None:
    det = GoDetector()
    with patch("subprocess.run", side_effect=FileNotFoundError("deadcode binary missing")):
        findings = det.detect_dead_code(tmp_path)
    assert len(findings) == 1
    assert "auditor_unavailable_deadcode" in findings[0].allowlist_key
