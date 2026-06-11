"""T2.2-T2.5 — detect_symbol_fabrication tests for all 4 languages.

Per-language detectors must:
- Detect fabricated packages (return [Finding(severity=HARD)])
- Skip stdlib + module-local imports (relative / crate:: / self-module / vendored)
- Cache 24h via _registry (EC-9 atomic writes)
- Tolerate registry HTTP failures (EC-2 → soft warning, never FP)
"""
from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import patch

import pytest

from scripts.check_symbol_fab import tree_sitter_available
from scripts.detectors.go import GoDetector
from scripts.detectors.python import PythonDetector
from scripts.detectors.rust import RustDetector
from scripts.detectors.typescript import TypescriptDetector

pytestmark = pytest.mark.skipif(
    not tree_sitter_available(),
    reason="tree-sitter-languages not installed; T2.2-T2.5 require it",
)


@pytest.fixture(autouse=True)
def _isolate_registry_cache(tmp_path: Path, monkeypatch):
    """Isolate the registry cache per test so cache hits don't leak."""
    monkeypatch.setenv("CODE_QUALITY_CACHE_DIR", str(tmp_path / "cache"))


# --------------------------------------------------------------------------
# Python (T2.2)
# --------------------------------------------------------------------------


def test_python_symbol_fab_flags_fabricated_package(tmp_path: Path) -> None:
    src = tmp_path / "x.py"
    src.write_text("import doesnotexist_xyz_123\n")
    det = PythonDetector()
    with patch(
        "scripts._registry.package_exists_on_pypi",
        return_value=False,
    ):
        findings = det.detect_symbol_fabrication([src])
    hard = [f for f in findings if f.severity == "HARD"]
    assert hard, "fabricated PyPI pkg must produce HARD Finding"
    # Stable identifier semantics: detector + language map to symbol_fabrication_python.
    assert hard[0].detector == "d2_symbol_fab"
    assert hard[0].language == "python"
    assert "symbol_fab" in hard[0].allowlist_key


def test_python_symbol_fab_no_finding_on_real_package(tmp_path: Path) -> None:
    src = tmp_path / "x.py"
    src.write_text("import requests\n")
    det = PythonDetector()
    with patch("scripts._registry.package_exists_on_pypi", return_value=True):
        findings = det.detect_symbol_fabrication([src])
    hard = [f for f in findings if f.severity == "HARD"]
    assert hard == []


def test_python_symbol_fab_skips_stdlib(tmp_path: Path) -> None:
    src = tmp_path / "x.py"
    src.write_text("import os\nimport sys\nimport json\n")
    det = PythonDetector()
    with patch(
        "scripts._registry.package_exists_on_pypi",
        side_effect=AssertionError("should NOT be called for stdlib"),
    ):
        findings = det.detect_symbol_fabrication([src])
    assert [f for f in findings if f.severity == "HARD"] == []


def test_python_symbol_fab_skips_relative_imports(tmp_path: Path) -> None:
    """EC-17 — relative imports MUST NOT trigger PyPI lookup."""
    src = tmp_path / "x.py"
    src.write_text("from . import sibling\nfrom ..parent import x\n")
    det = PythonDetector()
    with patch(
        "scripts._registry.package_exists_on_pypi",
        side_effect=AssertionError("should NOT be called for relative imports"),
    ) as mock:
        findings = det.detect_symbol_fabrication([src])
    assert mock.call_count == 0
    assert [f for f in findings if f.severity == "HARD"] == []


def test_python_symbol_fab_ambiguous_returns_soft_floor(tmp_path: Path) -> None:
    """EC-2 — registry None (HTML/timeout) MUST NOT produce HARD."""
    src = tmp_path / "x.py"
    src.write_text("import some_unverifiable_pkg\n")
    det = PythonDetector()
    with patch("scripts._registry.package_exists_on_pypi", return_value=None):
        findings = det.detect_symbol_fabrication([src])
    hard = [f for f in findings if f.severity == "HARD"]
    assert hard == []
    soft = [f for f in findings if f.severity == "SOFT_FLOOR"]
    assert soft, "ambiguous lookup MUST emit SOFT_FLOOR symbol_fab_unverifiable"


# --------------------------------------------------------------------------
# TypeScript (T2.3)
# --------------------------------------------------------------------------


def test_typescript_symbol_fab_flags_fabricated_package(tmp_path: Path) -> None:
    src = tmp_path / "x.ts"
    src.write_text("import { Foo } from 'doesnotexist-xyz-123';\n")
    det = TypescriptDetector()
    with patch("scripts._registry.package_exists_on_npm", return_value=False):
        findings = det.detect_symbol_fabrication([src])
    hard = [f for f in findings if f.severity == "HARD"]
    assert hard
    assert hard[0].detector == "d2_symbol_fab"
    assert hard[0].language == "typescript"


def test_typescript_symbol_fab_skips_relative_imports(tmp_path: Path) -> None:
    """EC-16 (relative + node builtins)"""
    src = tmp_path / "x.ts"
    src.write_text(
        "import { foo } from './sibling';\n"
        "import { bar } from '../utils';\n"
        "import { readFile } from 'node:fs';\n"
    )
    det = TypescriptDetector()
    with patch(
        "scripts._registry.package_exists_on_npm",
        side_effect=AssertionError("should NOT call for relative or node: imports"),
    ) as mock:
        findings = det.detect_symbol_fabrication([src])
    assert mock.call_count == 0
    assert [f for f in findings if f.severity == "HARD"] == []


# --------------------------------------------------------------------------
# Rust (T2.4)
# --------------------------------------------------------------------------


def test_rust_symbol_fab_flags_fabricated_crate(tmp_path: Path) -> None:
    src = tmp_path / "x.rs"
    src.write_text("use doesnotexist_xyz::Foo;\n")
    det = RustDetector()
    with patch("scripts._registry.crate_exists_on_crates_io", return_value=False):
        findings = det.detect_symbol_fabrication([src])
    hard = [f for f in findings if f.severity == "HARD"]
    assert hard


def test_rust_symbol_fab_skips_module_local(tmp_path: Path) -> None:
    """EC-17 analog — use crate::*, use super::*, use self::*"""
    src = tmp_path / "x.rs"
    src.write_text(
        "use crate::foo::bar;\n"
        "use super::utils;\n"
        "use self::helper;\n"
    )
    det = RustDetector()
    with patch(
        "scripts._registry.crate_exists_on_crates_io",
        side_effect=AssertionError("must not call for module-local uses"),
    ) as mock:
        findings = det.detect_symbol_fabrication([src])
    assert mock.call_count == 0
    assert [f for f in findings if f.severity == "HARD"] == []


# --------------------------------------------------------------------------
# Go (T2.5)
# --------------------------------------------------------------------------


def test_go_symbol_fab_flags_fabricated_module(tmp_path: Path) -> None:
    src = tmp_path / "x.go"
    src.write_text(
        'package main\nimport "github.com/doesnotexist/xyz"\n'
    )
    det = GoDetector()
    with patch("scripts._registry.module_exists_on_go_proxy", return_value=False):
        findings = det.detect_symbol_fabrication([src])
    hard = [f for f in findings if f.severity == "HARD"]
    assert hard


def test_go_symbol_fab_skips_stdlib(tmp_path: Path) -> None:
    """stdlib import paths (single segment, no slash) must skip proxy."""
    src = tmp_path / "x.go"
    src.write_text('package main\nimport "fmt"\n')
    det = GoDetector()
    # stdlib is treated as exists=True inside _registry; detector emits 0 HARD.
    findings = det.detect_symbol_fabrication([src])
    assert [f for f in findings if f.severity == "HARD"] == []


# --------------------------------------------------------------------------
# Cache integrity (EC-3 + EC-9)
# --------------------------------------------------------------------------


def test_registry_cache_recovers_from_corrupted_file(tmp_path: Path) -> None:
    """EC-3 — corrupted JSON cache file MUST NOT crash; rebuilds on next call."""
    from scripts import _registry

    cache_path = Path(os.environ["CODE_QUALITY_CACHE_DIR"]) / "python.json"
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text("{ broken json garbage")
    # Should not raise:
    loaded = _registry._load_cache("python")
    assert loaded == {}
