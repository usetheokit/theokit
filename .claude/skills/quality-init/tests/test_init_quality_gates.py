"""Tests for quality-init skill — init_quality_gates.py.

Covers: validate_target, detect_languages, detect_frameworks,
detect_existing_linters, detect_test_dirs, calibrate_thresholds,
threshold calibration logic, hook generation, settings.json merge.
"""

from __future__ import annotations

import json
import os
import sys
import textwrap
from pathlib import Path

import pytest

# Add scripts to path
SKILL_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL_ROOT / "scripts"))

from init_quality_gates import (
    FLOOR_COMPLEXITY,
    FLOOR_FILE_LINES,
    FLOOR_FUNCTION_LINES,
    FLOOR_NESTING_DEPTH,
    FLOOR_PARAMETERS,
    ThresholdCalibration,
    _measure_python_metrics,
    _percentile,
    calibrate_thresholds,
    detect_existing_linters,
    detect_frameworks,
    detect_languages,
    detect_test_dirs,
    validate_target,
)
from lib.path_safety import confine, confine_or_none
from lib.yaml_safe import merge_hook_into_settings, read_json, write_json


# ── Fixtures ──────────────────────────────────────────────────────────


@pytest.fixture
def tmp_project(tmp_path: Path) -> Path:
    """Create a minimal Python project in a temp directory."""
    src = tmp_path / "src"
    src.mkdir()

    # Simple Python file
    (src / "main.py").write_text(textwrap.dedent("""\
        def hello(name: str) -> str:
            return f"Hello, {name}!"

        def add(a: int, b: int) -> int:
            return a + b
    """))

    # A longer Python file with some complexity
    (src / "processor.py").write_text(textwrap.dedent("""\
        import os
        from pathlib import Path

        def process_data(items, config):
            results = []
            for item in items:
                if item.get("active"):
                    if item.get("type") == "A":
                        results.append(handle_type_a(item, config))
                    elif item.get("type") == "B":
                        results.append(handle_type_b(item, config))
                    else:
                        results.append(handle_default(item))
            return results

        def handle_type_a(item, config):
            return {"processed": True, "type": "A"}

        def handle_type_b(item, config):
            return {"processed": True, "type": "B"}

        def handle_default(item):
            return {"processed": True, "type": "default"}
    """))

    # pyproject.toml with ruff config
    (tmp_path / "pyproject.toml").write_text(textwrap.dedent("""\
        [project]
        name = "test-project"
        version = "0.1.0"

        [tool.ruff]
        line-length = 120
    """))

    # Test directory
    tests = tmp_path / "tests"
    tests.mkdir()
    (tests / "test_main.py").write_text(textwrap.dedent("""\
        from src.main import hello, add

        def test_hello():
            assert hello("World") == "Hello, World!"

        def test_add():
            assert add(1, 2) == 3
    """))

    return tmp_path


@pytest.fixture
def tmp_empty(tmp_path: Path) -> Path:
    """Create an empty directory."""
    return tmp_path


@pytest.fixture
def tmp_no_source(tmp_path: Path) -> Path:
    """Create a directory with only non-source files."""
    (tmp_path / "README.md").write_text("# Project")
    (tmp_path / "Dockerfile").write_text("FROM python:3.12")
    return tmp_path


# ── test _percentile ─────────────────────────────────────────────────


class TestPercentile:
    def test_empty_list(self) -> None:
        assert _percentile([], 90) == 0

    def test_single_value(self) -> None:
        assert _percentile([5], 90) == 5

    def test_p90_of_ten(self) -> None:
        values = list(range(1, 11))  # [1..10]
        result = _percentile(values, 90)
        assert result == 9

    def test_p50_is_median(self) -> None:
        values = [1, 2, 3, 4, 5]
        result = _percentile(values, 50)
        assert result == 3

    def test_all_same(self) -> None:
        assert _percentile([7, 7, 7, 7], 90) == 7


# ── test validate_target ─────────────────────────────────────────────


class TestValidateTarget:
    def test_valid_project(self, tmp_project: Path) -> None:
        result = validate_target(str(tmp_project))
        assert result == str(tmp_project.resolve())

    def test_nonexistent(self) -> None:
        with pytest.raises(SystemExit) as exc_info:
            validate_target("/nonexistent/path/xyz123")
        assert exc_info.value.code == 1

    def test_not_a_directory(self, tmp_path: Path) -> None:
        f = tmp_path / "file.txt"
        f.write_text("hello")
        with pytest.raises(SystemExit) as exc_info:
            validate_target(str(f))
        assert exc_info.value.code == 1

    def test_no_source_files(self, tmp_no_source: Path) -> None:
        with pytest.raises(SystemExit) as exc_info:
            validate_target(str(tmp_no_source))
        assert exc_info.value.code == 1


# ── test detect_languages ────────────────────────────────────────────


class TestDetectLanguages:
    def test_detects_python(self, tmp_project: Path) -> None:
        languages = detect_languages(str(tmp_project))
        names = [l.name for l in languages]
        assert "python" in names

    def test_file_counts(self, tmp_project: Path) -> None:
        languages = detect_languages(str(tmp_project))
        python = [l for l in languages if l.name == "python"][0]
        assert python.file_count >= 2  # main.py + processor.py (+ test_main.py)

    def test_loc_positive(self, tmp_project: Path) -> None:
        languages = detect_languages(str(tmp_project))
        python = [l for l in languages if l.name == "python"][0]
        assert python.loc > 0

    def test_empty_project(self, tmp_empty: Path) -> None:
        languages = detect_languages(str(tmp_empty))
        assert languages == []


# ── test detect_frameworks ───────────────────────────────────────────


class TestDetectFrameworks:
    def test_detects_pytest(self, tmp_project: Path) -> None:
        # pyproject.toml has [tool.ruff] but not pytest; add it
        pyproject = tmp_project / "pyproject.toml"
        content = pyproject.read_text()
        content += "\n[tool.pytest.ini_options]\ntestpaths = ['tests']\n"
        pyproject.write_text(content)

        # Also add conftest.py marker
        (tmp_project / "conftest.py").write_text("# conftest")

        frameworks = detect_frameworks(str(tmp_project))
        assert "Pytest" in frameworks

    def test_no_frameworks(self, tmp_empty: Path) -> None:
        frameworks = detect_frameworks(str(tmp_empty))
        assert frameworks == []

    def test_detects_fastapi(self, tmp_project: Path) -> None:
        (tmp_project / "src" / "app.py").write_text("from fastapi import FastAPI\napp = FastAPI()\n")
        frameworks = detect_frameworks(str(tmp_project))
        assert "FastAPI" in frameworks


# ── test detect_existing_linters ─────────────────────────────────────


class TestDetectExistingLinters:
    def test_detects_ruff(self, tmp_project: Path) -> None:
        linters = detect_existing_linters(str(tmp_project))
        assert "ruff" in linters

    def test_detects_eslintrc(self, tmp_project: Path) -> None:
        (tmp_project / ".eslintrc.json").write_text('{"rules": {}}')
        linters = detect_existing_linters(str(tmp_project))
        assert "eslint" in linters

    def test_no_linters(self, tmp_empty: Path) -> None:
        linters = detect_existing_linters(str(tmp_empty))
        assert linters == []


# ── test detect_test_dirs ────────────────────────────────────────────


class TestDetectTestDirs:
    def test_finds_tests_dir(self, tmp_project: Path) -> None:
        test_dirs = detect_test_dirs(str(tmp_project))
        assert any("tests" in d for d in test_dirs)

    def test_no_test_dirs(self, tmp_empty: Path) -> None:
        assert detect_test_dirs(str(tmp_empty)) == []


# ── test calibrate_thresholds ────────────────────────────────────────


class TestCalibrateThresholds:
    def test_strict_mode(self, tmp_project: Path) -> None:
        cal = calibrate_thresholds(str(tmp_project), strict=True)
        assert cal.max_complexity == 10
        assert cal.max_function_lines == 20
        assert cal.max_nesting_depth == 3
        assert cal.max_parameters == 4
        assert cal.max_file_lines == 300

    def test_adaptive_respects_floors(self, tmp_project: Path) -> None:
        cal = calibrate_thresholds(str(tmp_project))
        assert cal.max_complexity >= FLOOR_COMPLEXITY
        assert cal.max_function_lines >= FLOOR_FUNCTION_LINES
        assert cal.max_nesting_depth >= FLOOR_NESTING_DEPTH
        assert cal.max_parameters >= FLOOR_PARAMETERS
        assert cal.max_file_lines >= FLOOR_FILE_LINES

    def test_records_p90(self, tmp_project: Path) -> None:
        cal = calibrate_thresholds(str(tmp_project))
        assert cal.sample_count > 0
        assert cal.complexity_p90 is not None

    def test_skip_tests(self, tmp_project: Path) -> None:
        cal_with = calibrate_thresholds(str(tmp_project), skip_tests=False)
        cal_without = calibrate_thresholds(str(tmp_project), skip_tests=True)
        # skip_tests=True excludes test files, so sample count should be <= with tests
        assert cal_without.sample_count <= cal_with.sample_count


# ── test _measure_python_metrics ─────────────────────────────────────


class TestMeasurePythonMetrics:
    def test_simple_function(self, tmp_path: Path) -> None:
        f = tmp_path / "simple.py"
        f.write_text(textwrap.dedent("""\
            def greet(name):
                return f"Hello, {name}"
        """))
        metrics = _measure_python_metrics([f])
        assert len(metrics["complexity"]) == 1
        assert metrics["complexity"][0] == 1  # base complexity only

    def test_complex_function(self, tmp_path: Path) -> None:
        f = tmp_path / "complex.py"
        f.write_text(textwrap.dedent("""\
            def check(x, y, z):
                if x > 0:
                    if y > 0:
                        for i in range(z):
                            if i % 2 == 0:
                                print(i)
                return True
        """))
        metrics = _measure_python_metrics([f])
        assert metrics["complexity"][0] > 1
        assert metrics["nesting_depth"][0] >= 3

    def test_many_params(self, tmp_path: Path) -> None:
        f = tmp_path / "params.py"
        f.write_text(textwrap.dedent("""\
            def many(a, b, c, d, e, f):
                pass
        """))
        metrics = _measure_python_metrics([f])
        assert metrics["parameters"][0] == 6


# ── test path_safety ─────────────────────────────────────────────────


class TestPathSafety:
    def test_confine_inside(self, tmp_path: Path) -> None:
        sub = tmp_path / "sub"
        sub.mkdir()
        result = confine(str(tmp_path), str(sub))
        assert result == str(sub.resolve())

    def test_confine_traversal(self, tmp_path: Path) -> None:
        with pytest.raises(SystemExit) as exc_info:
            confine(str(tmp_path), str(tmp_path / ".." / ".." / "etc"))
        assert exc_info.value.code == 1

    def test_confine_or_none(self, tmp_path: Path) -> None:
        result = confine_or_none(str(tmp_path), str(tmp_path / ".." / ".."))
        assert result is None


# ── test merge_hook_into_settings ────────────────────────────────────


class TestMergeHookIntoSettings:
    def test_creates_new_settings(self, tmp_path: Path) -> None:
        settings_path = tmp_path / ".claude" / "settings.json"
        merged = merge_hook_into_settings(settings_path, "python3 check.py")
        assert "hooks" in merged
        assert "PostToolUse" in merged["hooks"]
        assert len(merged["hooks"]["PostToolUse"]) == 1
        assert merged["hooks"]["PostToolUse"][0]["hooks"][0]["command"] == "python3 check.py"

    def test_preserves_existing_hooks(self, tmp_path: Path) -> None:
        settings_path = tmp_path / "settings.json"
        existing = {
            "permissions": {"allow": ["Read"]},
            "hooks": {
                "PostToolUse": [
                    {
                        "matcher": "Write",
                        "hooks": [{"type": "command", "command": "existing_hook.sh"}],
                    }
                ]
            },
        }
        write_json(settings_path, existing)
        merged = merge_hook_into_settings(settings_path, "python3 new_hook.py")
        assert len(merged["hooks"]["PostToolUse"]) == 2
        assert merged["permissions"]["allow"] == ["Read"]

    def test_idempotent(self, tmp_path: Path) -> None:
        settings_path = tmp_path / "settings.json"
        merged1 = merge_hook_into_settings(settings_path, "python3 check.py")
        write_json(settings_path, merged1)
        merged2 = merge_hook_into_settings(settings_path, "python3 check.py")
        assert len(merged2["hooks"]["PostToolUse"]) == 1  # not duplicated


# ── test read_json / write_json ──────────────────────────────────────


class TestJsonIO:
    def test_read_nonexistent(self, tmp_path: Path) -> None:
        result = read_json(tmp_path / "nope.json")
        assert result == {}

    def test_round_trip(self, tmp_path: Path) -> None:
        path = tmp_path / "test.json"
        data = {"key": "value", "nested": {"a": 1}}
        write_json(path, data)
        loaded = read_json(path)
        assert loaded == data
