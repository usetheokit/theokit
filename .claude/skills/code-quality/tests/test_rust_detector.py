"""T1.3 — RustDetector.detect_dead_code (cargo-udeps wrapper) tests.

cargo-udeps requires nightly toolchain. Tests use subprocess mocks.
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from scripts.detectors.rust import RustDetector

pytestmark = pytest.mark.rust


_UDEPS_POSITIVE_JSON = json.dumps(
    {
        "success": False,
        "unused_deps": {
            "my-crate 0.1.0": {
                "manifest_path": "/abs/Cargo.toml",
                "normal": ["unused-crate"],
                "development": [],
                "build": [],
            }
        },
    }
)

_UDEPS_CLEAN_JSON = json.dumps({"success": True, "unused_deps": {}})


def _mock_run(stdout: str, returncode: int = 0, stderr: str = ""):
    class _R:
        def __init__(self) -> None:
            self.stdout = stdout
            self.stderr = stderr
            self.returncode = returncode

    return _R()


def test_rust_detector_flags_unused_dep(tmp_path: Path) -> None:
    det = RustDetector()
    with patch("subprocess.run", return_value=_mock_run(_UDEPS_POSITIVE_JSON, 1)):
        findings = det.detect_dead_code(tmp_path)
    dead = [f for f in findings if f.detector == "d1_dead_code"]
    assert any("unused-crate" in f.symbol_or_line for f in dead)


def test_rust_detector_no_findings_on_clean(tmp_path: Path) -> None:
    det = RustDetector()
    with patch("subprocess.run", return_value=_mock_run(_UDEPS_CLEAN_JSON, 0)):
        findings = det.detect_dead_code(tmp_path)
    dead = [f for f in findings if f.detector == "d1_dead_code"]
    assert dead == []


def test_rust_detector_emits_auditor_unavailable_when_nightly_missing(tmp_path: Path) -> None:
    det = RustDetector()
    with patch("subprocess.run", side_effect=FileNotFoundError("cargo +nightly missing")):
        findings = det.detect_dead_code(tmp_path)
    assert len(findings) == 1
    assert "auditor_unavailable_cargo-udeps" in findings[0].allowlist_key


def test_rust_detector_handles_malformed_json(tmp_path: Path) -> None:
    det = RustDetector()
    with patch("subprocess.run", return_value=_mock_run("not json at all", 1)):
        findings = det.detect_dead_code(tmp_path)
    assert len(findings) == 1
    assert "auditor_output_malformed_cargo-udeps" in findings[0].allowlist_key
