"""T1.2 — TypescriptDetector.detect_dead_code (knip wrapper) tests.

Per plan v1.3 § T1.2. Uses subprocess mocks because knip is not installed
in the test environment.
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from scripts.detectors.typescript import TypescriptDetector

pytestmark = pytest.mark.typescript


_KNIP_POSITIVE_JSON = json.dumps(
    {
        "files": ["src/orphan.ts"],
        "exports": [{"file": "src/foo.ts", "name": "unusedExport"}],
        "dependencies": [{"name": "unused-dep"}],
        "devDependencies": [],
        "duplicates": [],
    }
)


_KNIP_CLEAN_JSON = json.dumps(
    {
        "files": [],
        "exports": [],
        "dependencies": [],
        "devDependencies": [],
        "duplicates": [],
    }
)


def _mock_run(stdout: str, returncode: int = 1):
    """Build a CompletedProcess-shaped object for subprocess.run mock."""

    class _Result:
        def __init__(self):
            self.stdout = stdout
            self.stderr = ""
            self.returncode = returncode

    return _Result()


def test_typescript_detector_flags_unused_export(tmp_path: Path) -> None:
    """Knip reporting unusedExport MUST surface as ≥1 dead-code Finding."""
    detector = TypescriptDetector()
    with patch("subprocess.run", return_value=_mock_run(_KNIP_POSITIVE_JSON, 1)):
        findings = detector.detect_dead_code(tmp_path)
    dead = [f for f in findings if f.detector == "d1_dead_code"]
    assert len(dead) >= 1
    symbols = {f.symbol_or_line for f in dead}
    assert any("unusedExport" in s or "orphan.ts" in s or "unused-dep" in s for s in symbols)


def test_typescript_detector_flags_unused_file(tmp_path: Path) -> None:
    """An unreferenced .ts file in knip output MUST surface as a Finding."""
    detector = TypescriptDetector()
    with patch("subprocess.run", return_value=_mock_run(_KNIP_POSITIVE_JSON, 1)):
        findings = detector.detect_dead_code(tmp_path)
    assert any("orphan.ts" in f.symbol_or_line for f in findings if f.detector == "d1_dead_code")


def test_typescript_detector_no_findings_on_clean(tmp_path: Path) -> None:
    """Knip reporting empty arrays MUST produce zero dead-code Findings."""
    detector = TypescriptDetector()
    with patch("subprocess.run", return_value=_mock_run(_KNIP_CLEAN_JSON, 0)):
        findings = detector.detect_dead_code(tmp_path)
    dead = [f for f in findings if f.detector == "d1_dead_code"]
    assert dead == []


def test_typescript_detector_emits_auditor_unavailable_when_knip_missing(tmp_path: Path) -> None:
    detector = TypescriptDetector()
    with patch("subprocess.run", side_effect=FileNotFoundError("knip not found")):
        findings = detector.detect_dead_code(tmp_path)
    assert len(findings) == 1
    assert "auditor_unavailable_knip" in findings[0].allowlist_key
    assert findings[0].severity == "SOFT_CAP"


def test_typescript_detector_handles_malformed_json(tmp_path: Path) -> None:
    """EC-1 — malformed knip output emits Finding, never crashes."""
    detector = TypescriptDetector()
    with patch("subprocess.run", return_value=_mock_run("{ this is not json", 1)):
        findings = detector.detect_dead_code(tmp_path)
    assert len(findings) == 1
    assert "auditor_output_malformed" in findings[0].allowlist_key
