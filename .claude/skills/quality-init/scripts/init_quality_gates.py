#!/usr/bin/env python3
"""quality-init — 10-stage initializer for Claude Code quality-gate hooks.

Analyzes a target project, calibrates thresholds from actual code metrics,
and emits PostToolUse hook scripts + settings.json patch.

Exit codes:
  0 — success
  1 — target invalid / empty / no source files
  2 — required tool missing
  3 — hook files exist, --force not set
  4 — internal IO / parse error
  5 — settings.json patch conflict
"""

from __future__ import annotations

import argparse
import ast
import json
import math
import os
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Allow importing sibling lib modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lib.path_safety import confine
from lib.yaml_safe import merge_hook_into_settings, read_json, write_json

# ── Constants ─────────────────────────────────────────────────────────

SKILL_ROOT = Path(__file__).resolve().parent.parent
HOOKS_TPL_DIR = SKILL_ROOT / "scripts" / "hooks"

LANGUAGE_EXTENSIONS: dict[str, set[str]] = {
    "python": {".py"},
    "typescript": {".ts", ".tsx"},
    "javascript": {".js", ".jsx", ".mjs", ".cjs"},
    "go": {".go"},
    "rust": {".rs"},
    "java": {".java"},
    "c": {".c", ".h"},
    "cpp": {".cpp", ".cc", ".cxx", ".hpp"},
    "csharp": {".cs"},
}

SKIP_DIRS: set[str] = {
    "node_modules", "__pycache__", ".git", "dist", "build", ".next",
    ".venv", "venv", "target", "vendor", ".mypy_cache", ".pytest_cache",
    ".ruff_cache", "coverage", ".nyc_output", ".tox", "eggs",
    ".egg-info", ".cache", ".turbo", ".parcel-cache",
}

TEST_PATTERNS: list[str] = [
    "test_*.py", "*_test.py", "*.test.ts", "*.spec.ts",
    "*.test.js", "*.spec.js", "*.test.tsx", "*.spec.tsx",
    "*_test.go", "Test*.java",
]

TEST_DIR_NAMES: set[str] = {
    "tests", "test", "__tests__", "spec", "specs",
    "testing", "test_suite", "e2e", "integration_tests",
}

FRAMEWORK_MARKERS: dict[str, list[tuple[str, str]]] = {
    # (file_pattern, content_pattern)
    "Django": [("settings.py", "INSTALLED_APPS"), ("manage.py", "django")],
    "FastAPI": [("*.py", r"from fastapi import|import fastapi")],
    "Flask": [("*.py", r"from flask import|import flask")],
    "Express": [("*.js", r"require\(['\"]express['\"]\)"), ("*.ts", r"from ['\"]express['\"]")],
    "Next.js": [("next.config.*", ""), ("package.json", '"next"')],
    "React": [("package.json", '"react"')],
    "Vue": [("package.json", '"vue"')],
    "Angular": [("package.json", '"@angular/core"')],
    "Gin": [("go.mod", "github.com/gin-gonic/gin")],
    "Echo": [("go.mod", "github.com/labstack/echo")],
    "Axum": [("Cargo.toml", "axum")],
    "Actix-web": [("Cargo.toml", "actix-web")],
    "Spring": [("pom.xml", "spring-boot"), ("build.gradle", "spring-boot")],
    "Pydantic": [("*.py", r"from pydantic import|import pydantic")],
    "Click": [("*.py", r"import click|from click import")],
    "Typer": [("*.py", r"import typer|from typer import")],
    "Pytest": [("pyproject.toml", "pytest"), ("pytest.ini", ""), ("conftest.py", "")],
    "Jest": [("package.json", '"jest"'), ("jest.config.*", "")],
    "Vitest": [("package.json", '"vitest"'), ("vitest.config.*", "")],
    "Playwright": [("package.json", '"@playwright/test"'), ("playwright.config.*", "")],
}

LINTER_CONFIGS: dict[str, list[str]] = {
    "ruff": [".ruff.toml", "ruff.toml", "pyproject.toml"],
    "eslint": [".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", "eslint.config.js", "eslint.config.mjs"],
    "pylint": [".pylintrc", "pylintrc"],
    "flake8": [".flake8", "setup.cfg"],
    "mypy": ["mypy.ini", ".mypy.ini"],
    "biome": ["biome.json", "biome.jsonc"],
    "prettier": [".prettierrc", ".prettierrc.json", ".prettierrc.js", "prettier.config.js"],
    "golangci-lint": [".golangci.yml", ".golangci.yaml", ".golangci.toml"],
    "clippy": ["clippy.toml", ".clippy.toml"],
    "editorconfig": [".editorconfig"],
}

# Minimum floors — thresholds never go below these
FLOOR_COMPLEXITY = 10
FLOOR_FUNCTION_LINES = 20
FLOOR_NESTING_DEPTH = 3
FLOOR_PARAMETERS = 4
FLOOR_FILE_LINES = 300

# Strict mode values (match industry standard recommendations)
STRICT_COMPLEXITY = 10
STRICT_FUNCTION_LINES = 20
STRICT_NESTING_DEPTH = 3
STRICT_PARAMETERS = 4
STRICT_FILE_LINES = 300


# ── Data classes ──────────────────────────────────────────────────────


@dataclass
class LanguageInfo:
    name: str
    file_count: int = 0
    loc: int = 0
    extensions: set[str] = field(default_factory=set)


@dataclass
class ThresholdCalibration:
    max_complexity: int = FLOOR_COMPLEXITY
    max_function_lines: int = FLOOR_FUNCTION_LINES
    max_nesting_depth: int = FLOOR_NESTING_DEPTH
    max_parameters: int = FLOOR_PARAMETERS
    max_file_lines: int = FLOOR_FILE_LINES
    duplicate_min_lines: int = 4
    duplicate_min_occurrences: int = 2

    # Source tracking
    complexity_p90: int | None = None
    function_lines_p90: int | None = None
    nesting_depth_p90: int | None = None
    parameters_p90: int | None = None
    file_lines_p90: int | None = None
    sample_count: int = 0


@dataclass
class InitResult:
    target: str = ""
    languages: list[LanguageInfo] = field(default_factory=list)
    frameworks: list[str] = field(default_factory=list)
    existing_linters: list[str] = field(default_factory=list)
    test_dirs: list[str] = field(default_factory=list)
    thresholds: ThresholdCalibration = field(default_factory=ThresholdCalibration)
    hooks_dir: str = ""
    settings_patched: bool = False
    lizard_available: bool = False
    generated_date: str = ""


# ── Utility ───────────────────────────────────────────────────────────


def _percentile(values: list[int | float], pct: int) -> int:
    """Compute the p-th percentile. Returns int (ceiling)."""
    if not values:
        return 0
    sorted_vals = sorted(values)
    idx = math.ceil(len(sorted_vals) * pct / 100) - 1
    idx = max(0, min(idx, len(sorted_vals) - 1))
    return int(math.ceil(sorted_vals[idx]))


def _walk_source_files(
    target: str,
    skip_dirs: set[str],
    skip_test_dirs: bool = False,
    test_dir_names: set[str] | None = None,
) -> list[Path]:
    """Walk target directory and yield source files, respecting skip dirs."""
    all_exts: set[str] = set()
    for exts in LANGUAGE_EXTENSIONS.values():
        all_exts.update(exts)

    files: list[Path] = []
    test_names = test_dir_names or TEST_DIR_NAMES

    for root, dirs, filenames in os.walk(target):
        # Prune skip dirs in-place
        dirs[:] = [
            d for d in dirs
            if d not in skip_dirs
            and not d.endswith(".egg-info")
        ]
        if skip_test_dirs:
            dirs[:] = [d for d in dirs if d.lower() not in test_names]

        for fname in filenames:
            ext = Path(fname).suffix.lower()
            if ext in all_exts:
                files.append(Path(root) / fname)

    return files


def _log(msg: str, verbose: bool) -> None:
    if verbose:
        print(f"  [quality-init] {msg}", file=sys.stderr)


# ── Stage 1: validate_target ─────────────────────────────────────────


def validate_target(target: str) -> str:
    """Validate the target directory exists and contains source files."""
    target_path = Path(target).resolve()

    if not target_path.exists():
        print(f"Target does not exist: {target_path}", file=sys.stderr)
        raise SystemExit(1)

    if not target_path.is_dir():
        print(f"Target is not a directory: {target_path}", file=sys.stderr)
        raise SystemExit(1)

    files = _walk_source_files(str(target_path), SKIP_DIRS)
    if not files:
        print(
            f"No source files found in {target_path}. "
            "Supported: Python, TypeScript, JavaScript, Go, Rust, Java, C, C++, C#.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    return str(target_path)


# ── Stage 2: detect_languages ────────────────────────────────────────


def detect_languages(target: str, verbose: bool = False) -> list[LanguageInfo]:
    """Detect languages present in the project with file counts and LOC."""
    files = _walk_source_files(target, SKIP_DIRS)
    lang_files: dict[str, list[Path]] = defaultdict(list)

    for f in files:
        ext = f.suffix.lower()
        for lang, exts in LANGUAGE_EXTENSIONS.items():
            if ext in exts:
                lang_files[lang].append(f)
                break

    languages: list[LanguageInfo] = []
    for lang, paths in sorted(lang_files.items()):
        loc = 0
        for p in paths:
            try:
                loc += len(p.read_text(encoding="utf-8", errors="replace").splitlines())
            except OSError:
                pass

        info = LanguageInfo(
            name=lang,
            file_count=len(paths),
            loc=loc,
            extensions={p.suffix.lower() for p in paths},
        )
        languages.append(info)
        _log(f"Detected {lang}: {len(paths)} files, {loc} LOC", verbose)

    return languages


# ── Stage 3: detect_frameworks ───────────────────────────────────────


def detect_frameworks(target: str, verbose: bool = False) -> list[str]:
    """Detect frameworks used in the project."""
    detected: list[str] = []

    for framework, markers in FRAMEWORK_MARKERS.items():
        found = False
        for file_pattern, content_pattern in markers:
            if found:
                break
            # Search for matching files
            for f in Path(target).rglob(file_pattern):
                if any(skip in f.parts for skip in SKIP_DIRS):
                    continue
                if not content_pattern:
                    found = True
                    break
                try:
                    content = f.read_text(encoding="utf-8", errors="replace")
                    if re.search(content_pattern, content):
                        found = True
                        break
                except OSError:
                    pass

        if found:
            detected.append(framework)
            _log(f"Detected framework: {framework}", verbose)

    return sorted(detected)


# ── Stage 4: detect_existing_linters ─────────────────────────────────


def detect_existing_linters(target: str, verbose: bool = False) -> list[str]:
    """Detect existing linter/formatter configurations."""
    found: list[str] = []

    for linter, config_files in LINTER_CONFIGS.items():
        for config in config_files:
            config_path = Path(target) / config
            if config_path.exists():
                # For pyproject.toml and setup.cfg, check if the linter section exists
                if config in ("pyproject.toml", "setup.cfg"):
                    try:
                        content = config_path.read_text(encoding="utf-8", errors="replace")
                        if linter == "ruff" and "[tool.ruff]" not in content:
                            continue
                        if linter == "flake8" and "[flake8]" not in content:
                            continue
                        if linter == "pylint" and "[pylint" not in content:
                            continue
                    except OSError:
                        continue

                found.append(linter)
                _log(f"Detected linter config: {linter} ({config})", verbose)
                break

    return sorted(set(found))


# ── Stage 5: detect_test_dirs ────────────────────────────────────────


def detect_test_dirs(target: str, verbose: bool = False) -> list[str]:
    """Detect test directories in the project."""
    test_dirs: list[str] = []

    for root, dirs, _files in os.walk(target):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for d in dirs:
            if d.lower() in TEST_DIR_NAMES:
                rel = os.path.relpath(os.path.join(root, d), target)
                test_dirs.append(rel)
                _log(f"Detected test dir: {rel}", verbose)

    return sorted(test_dirs)


# ── Stage 6: calibrate_thresholds ────────────────────────────────────


def _measure_python_metrics(files: list[Path]) -> dict[str, list[int]]:
    """Measure complexity, function length, nesting, and params from Python files."""
    metrics: dict[str, list[int]] = {
        "complexity": [],
        "function_lines": [],
        "nesting_depth": [],
        "parameters": [],
        "file_lines": [],
    }

    for f in files:
        try:
            source = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        lines = source.splitlines()
        metrics["file_lines"].append(len(lines))

        try:
            tree = ast.parse(source, filename=str(f))
        except SyntaxError:
            continue

        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue

            # Complexity
            complexity = 1
            for child in ast.walk(node):
                if isinstance(child, (ast.If, ast.For, ast.While, ast.ExceptHandler, ast.Assert)):
                    complexity += 1
                elif isinstance(child, ast.BoolOp):
                    complexity += len(child.values) - 1
                elif isinstance(child, ast.comprehension):
                    complexity += 1 + len(child.ifs)
            metrics["complexity"].append(complexity)

            # Function length
            if hasattr(node, "end_lineno") and node.end_lineno is not None:
                length = node.end_lineno - node.lineno + 1
                metrics["function_lines"].append(length)

            # Nesting
            def max_nesting(n: ast.AST, depth: int = 0) -> int:
                md = depth
                nesting_types = (ast.If, ast.For, ast.While, ast.With, ast.Try, ast.ExceptHandler)
                for c in ast.iter_child_nodes(n):
                    if isinstance(c, nesting_types):
                        md = max(md, max_nesting(c, depth + 1))
                    else:
                        md = max(md, max_nesting(c, depth))
                return md

            metrics["nesting_depth"].append(max_nesting(node))

            # Parameters
            args = node.args
            all_args = args.posonlyargs + args.args + args.kwonlyargs
            count = len(all_args)
            if all_args and all_args[0].arg in ("self", "cls"):
                count -= 1
            if args.vararg:
                count += 1
            if args.kwarg:
                count += 1
            metrics["parameters"].append(count)

    return metrics


def calibrate_thresholds(
    target: str,
    strict: bool = False,
    skip_tests: bool = False,
    verbose: bool = False,
) -> ThresholdCalibration:
    """Calibrate thresholds from actual project metrics."""
    if strict:
        _log("Using strict thresholds (ignoring project metrics)", verbose)
        return ThresholdCalibration(
            max_complexity=STRICT_COMPLEXITY,
            max_function_lines=STRICT_FUNCTION_LINES,
            max_nesting_depth=STRICT_NESTING_DEPTH,
            max_parameters=STRICT_PARAMETERS,
            max_file_lines=STRICT_FILE_LINES,
        )

    files = _walk_source_files(target, SKIP_DIRS, skip_test_dirs=skip_tests)
    py_files = [f for f in files if f.suffix.lower() == ".py"]

    if not py_files:
        # No Python files — measure file lengths only, use floors for the rest
        all_files = files
        file_lines: list[int] = []
        for f in all_files:
            try:
                file_lines.append(len(f.read_text(encoding="utf-8", errors="replace").splitlines()))
            except OSError:
                pass

        p90_file = _percentile(file_lines, 90) if file_lines else 0
        cal = ThresholdCalibration(
            max_file_lines=max(FLOOR_FILE_LINES, p90_file),
            file_lines_p90=p90_file if file_lines else None,
            sample_count=len(all_files),
        )
        _log(f"No Python files — file_lines p90={p90_file}, using floors for function metrics", verbose)
        return cal

    metrics = _measure_python_metrics(py_files)

    p90_complexity = _percentile(metrics["complexity"], 90)
    p90_func_lines = _percentile(metrics["function_lines"], 90)
    p90_nesting = _percentile(metrics["nesting_depth"], 90)
    p90_params = _percentile(metrics["parameters"], 90)
    p90_file_lines = _percentile(metrics["file_lines"], 90)

    cal = ThresholdCalibration(
        max_complexity=max(FLOOR_COMPLEXITY, p90_complexity),
        max_function_lines=max(FLOOR_FUNCTION_LINES, p90_func_lines),
        max_nesting_depth=max(FLOOR_NESTING_DEPTH, p90_nesting),
        max_parameters=max(FLOOR_PARAMETERS, p90_params),
        max_file_lines=max(FLOOR_FILE_LINES, p90_file_lines),
        complexity_p90=p90_complexity,
        function_lines_p90=p90_func_lines,
        nesting_depth_p90=p90_nesting,
        parameters_p90=p90_params,
        file_lines_p90=p90_file_lines,
        sample_count=len(py_files),
    )

    _log(
        f"Calibrated from {len(py_files)} Python files: "
        f"complexity p90={p90_complexity}, func_lines p90={p90_func_lines}, "
        f"nesting p90={p90_nesting}, params p90={p90_params}, "
        f"file_lines p90={p90_file_lines}",
        verbose,
    )

    return cal


# ── Stage 7: smoke_test_tools ────────────────────────────────────────


def smoke_test_tools(
    allow_missing: bool = False,
    verbose: bool = False,
) -> tuple[bool, bool]:
    """Verify required tools. Returns (python3_ok, lizard_available)."""
    # Python3 is always required (hook scripts are Python)
    python3_ok = shutil.which("python3") is not None
    if not python3_ok:
        print("Required: python3 is not in PATH.", file=sys.stderr)
        raise SystemExit(2)

    # Lizard is optional (multi-language support)
    lizard_available = False
    try:
        result = subprocess.run(
            ["python3", "-c", "import lizard; print(lizard.version)"],
            capture_output=True, text=True, timeout=10,
        )
        lizard_available = result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    if not lizard_available:
        msg = "Optional: lizard not installed. JS/TS/Go/Rust/Java/C analysis will be limited to file-level checks."
        if not allow_missing:
            _log(msg, verbose)
            print(
                f"lizard not installed. Install with: python3 -m pip install lizard\n"
                f"Or re-run with --allow-missing-tools to continue without multi-language analysis.",
                file=sys.stderr,
            )
            raise SystemExit(2)
        _log(msg, verbose)

    return python3_ok, lizard_available


# ── Stage 8: generate_hook_scripts ───────────────────────────────────


def _build_threshold_comments(cal: ThresholdCalibration) -> str:
    """Build human-readable comments for each threshold."""
    lines: list[str] = []

    def _comment(name: str, value: int, p90: int | None, floor: int) -> str:
        if p90 is not None:
            source = f"p90 = {p90}, floor = {floor}"
            which = "p90" if p90 >= floor else "floor"
            return f"# {name}: {source} -> using {which}"
        return f"# {name}: no measurements, using floor = {floor}"

    lines.append(_comment("max_complexity", cal.max_complexity, cal.complexity_p90, FLOOR_COMPLEXITY))
    lines.append(_comment("max_function_lines", cal.max_function_lines, cal.function_lines_p90, FLOOR_FUNCTION_LINES))
    lines.append(_comment("max_nesting_depth", cal.max_nesting_depth, cal.nesting_depth_p90, FLOOR_NESTING_DEPTH))
    lines.append(_comment("max_parameters", cal.max_parameters, cal.parameters_p90, FLOOR_PARAMETERS))
    lines.append(_comment("max_file_lines", cal.max_file_lines, cal.file_lines_p90, FLOOR_FILE_LINES))

    if cal.sample_count > 0:
        lines.append(f"# Calibrated from {cal.sample_count} source files")

    return "\n".join(lines)


def _build_skip_dirs_entries(test_dirs: list[str]) -> str:
    """Build the SKIP_DIRS frozenset entries for smell_types.py."""
    dirs = sorted(SKIP_DIRS)
    # Add test dirs if detected (commented out by default for user to enable)
    entries = [f'    "{d}",' for d in dirs]
    if test_dirs:
        entries.append("    # Detected test directories (uncomment to skip):")
        for td in sorted(test_dirs):
            dirname = Path(td).name
            entries.append(f'    # "{dirname}",')
    return "\n".join(entries)


def generate_hook_scripts(
    hooks_dir: str,
    cal: ThresholdCalibration,
    test_dirs: list[str],
    force: bool = False,
    verbose: bool = False,
) -> str:
    """Generate the 4 hook Python files from templates."""
    hooks_path = Path(hooks_dir)

    # Check if files already exist
    hook_files = ["check_quality.py", "smell_types.py", "smell_python.py", "smell_checks.py"]
    if not force:
        existing = [f for f in hook_files if (hooks_path / f).exists()]
        if existing:
            print(
                f"Hook files already exist in {hooks_dir}: {', '.join(existing)}\n"
                f"Use --force to overwrite or --out to write elsewhere.",
                file=sys.stderr,
            )
            raise SystemExit(3)

    hooks_path.mkdir(parents=True, exist_ok=True)

    generated_date = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # Template substitution values
    subs = {
        "generated_date": generated_date,
        "max_complexity": str(cal.max_complexity),
        "max_function_lines": str(cal.max_function_lines),
        "max_nesting_depth": str(cal.max_nesting_depth),
        "max_parameters": str(cal.max_parameters),
        "max_file_lines": str(cal.max_file_lines),
        "duplicate_min_lines": str(cal.duplicate_min_lines),
        "duplicate_min_occurrences": str(cal.duplicate_min_occurrences),
        "threshold_comments": _build_threshold_comments(cal),
        "skip_dirs_entries": _build_skip_dirs_entries(test_dirs),
    }

    for tpl_name in hook_files:
        tpl_path = HOOKS_TPL_DIR / f"{tpl_name}.tpl"
        if not tpl_path.exists():
            print(f"Template not found: {tpl_path}", file=sys.stderr)
            raise SystemExit(4)

        content = tpl_path.read_text(encoding="utf-8")

        # Only substitute simple {key} patterns, not Python f-strings or dict literals
        # Templates use {key} for our substitutions and {{ / }} for literal braces
        for key, value in subs.items():
            content = content.replace(f"{{{key}}}", value)

        # Unescape doubled braces back to single braces (template convention)
        content = content.replace("{{", "{").replace("}}", "}")

        out_path = hooks_path / tpl_name
        out_path.write_text(content, encoding="utf-8")

        # Make entry point executable
        if tpl_name == "check_quality.py":
            out_path.chmod(0o755)

        _log(f"Generated {out_path}", verbose)

    return str(hooks_path)


# ── Stage 9: patch_settings_json ─────────────────────────────────────


def patch_settings_json(
    target: str,
    hooks_dir: str,
    no_patch: bool = False,
    verbose: bool = False,
) -> bool:
    """Merge PostToolUse hook into .claude/settings.json."""
    if no_patch:
        _log("Skipping settings.json patch (--no-settings-patch)", verbose)
        return False

    settings_path = Path(target) / ".claude" / "settings.json"
    hook_command = f"python3 {hooks_dir}/check_quality.py"

    try:
        merged = merge_hook_into_settings(settings_path, hook_command)
        write_json(settings_path, merged)
        _log(f"Patched {settings_path}", verbose)
        return True
    except (json.JSONDecodeError, OSError) as exc:
        print(f"Failed to patch {settings_path}: {exc}", file=sys.stderr)
        raise SystemExit(5) from exc


# ── Stage 10: validate_round_trip ────────────────────────────────────


def validate_round_trip(hooks_dir: str, verbose: bool = False) -> bool:
    """Invoke check_quality.py with a synthetic event to verify it works."""
    hook_script = Path(hooks_dir) / "check_quality.py"
    if not hook_script.exists():
        print(f"Hook script not found: {hook_script}", file=sys.stderr)
        raise SystemExit(4)

    synthetic_event = json.dumps({
        "tool_input": {"file_path": "/nonexistent/file.py"},
    })

    try:
        result = subprocess.run(
            ["python3", str(hook_script)],
            input=synthetic_event,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except subprocess.TimeoutExpired:
        print(f"Hook script timed out during validation: {hook_script}", file=sys.stderr)
        raise SystemExit(4)

    if result.returncode != 0:
        print(
            f"Hook script failed validation (exit {result.returncode}):\n"
            f"  stdout: {result.stdout.strip()}\n"
            f"  stderr: {result.stderr.strip()}",
            file=sys.stderr,
        )
        raise SystemExit(4)

    _log("Round-trip validation passed", verbose)
    return True


# ── Report ────────────────────────────────────────────────────────────


def _format_report(result: InitResult) -> str:
    """Format the human-readable report."""
    lines: list[str] = []
    lines.append("=" * 60)
    lines.append("  quality-init — Quality Gate Hooks Generated")
    lines.append("=" * 60)
    lines.append("")

    lines.append(f"Target: {result.target}")
    lines.append(f"Generated: {result.generated_date}")
    lines.append("")

    # Languages
    lines.append("Languages detected:")
    if result.languages:
        for lang in result.languages:
            lines.append(f"  - {lang.name}: {lang.file_count} files, {lang.loc} LOC")
    else:
        lines.append("  (none)")
    lines.append("")

    # Frameworks
    lines.append("Frameworks detected:")
    if result.frameworks:
        for fw in result.frameworks:
            lines.append(f"  - {fw}")
    else:
        lines.append("  (none)")
    lines.append("")

    # Existing linters
    lines.append("Existing linter configs:")
    if result.existing_linters:
        for linter in result.existing_linters:
            lines.append(f"  - {linter}")
    else:
        lines.append("  (none)")
    lines.append("")

    # Test dirs
    lines.append("Test directories:")
    if result.test_dirs:
        for td in result.test_dirs:
            lines.append(f"  - {td}")
    else:
        lines.append("  (none)")
    lines.append("")

    # Thresholds
    cal = result.thresholds
    lines.append("Calibrated thresholds:")
    lines.append(f"  max_complexity:      {cal.max_complexity:>4}  (p90={cal.complexity_p90 or '-'}, floor={FLOOR_COMPLEXITY})")
    lines.append(f"  max_function_lines:  {cal.max_function_lines:>4}  (p90={cal.function_lines_p90 or '-'}, floor={FLOOR_FUNCTION_LINES})")
    lines.append(f"  max_nesting_depth:   {cal.max_nesting_depth:>4}  (p90={cal.nesting_depth_p90 or '-'}, floor={FLOOR_NESTING_DEPTH})")
    lines.append(f"  max_parameters:      {cal.max_parameters:>4}  (p90={cal.parameters_p90 or '-'}, floor={FLOOR_PARAMETERS})")
    lines.append(f"  max_file_lines:      {cal.max_file_lines:>4}  (p90={cal.file_lines_p90 or '-'}, floor={FLOOR_FILE_LINES})")
    lines.append(f"  duplicate_min_lines: {cal.duplicate_min_lines:>4}  (fixed)")
    if cal.sample_count > 0:
        lines.append(f"  (calibrated from {cal.sample_count} source files)")
    lines.append("")

    # Tools
    lines.append(f"Lizard (multi-language): {'available' if result.lizard_available else 'NOT available'}")
    lines.append("")

    # Generated files
    lines.append("Generated files:")
    lines.append(f"  {result.hooks_dir}/check_quality.py   (entry point)")
    lines.append(f"  {result.hooks_dir}/smell_types.py     (thresholds)")
    lines.append(f"  {result.hooks_dir}/smell_python.py    (Python analyzer)")
    lines.append(f"  {result.hooks_dir}/smell_checks.py    (orchestrator)")
    if result.settings_patched:
        lines.append(f"  {result.target}/.claude/settings.json (patched)")
    lines.append("")

    # Next steps
    lines.append("Next steps:")
    lines.append("  1. Review thresholds in smell_types.py and adjust if needed.")
    if not result.lizard_available:
        lines.append("  2. Install lizard for multi-language support: python3 -m pip install lizard")
    lines.append(f"  {'3' if not result.lizard_available else '2'}. Test the hook: echo '{{\"tool_input\":{{\"file_path\":\"any_file.py\"}}}}' | python3 {result.hooks_dir}/check_quality.py")
    if not result.settings_patched:
        lines.append("  Add this to your .claude/settings.json manually:")
        lines.append('    "hooks": { "PostToolUse": [{ "matcher": "Write|Edit", "hooks": [{ "type": "command", "command": "python3 ' + result.hooks_dir + '/check_quality.py" }] }] }')
    lines.append("")
    lines.append("=" * 60)

    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Initialize Claude Code quality-gate hooks for a project.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("target", help="Path to the project directory")
    parser.add_argument("--out", help="Output directory for hook scripts (default: <TARGET>/.claude/hooks/)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing hook files")
    parser.add_argument("--strict", action="store_true", help="Use strict thresholds (ignore project metrics)")
    parser.add_argument("--allow-missing-tools", action="store_true", help="Continue if lizard is not installed")
    parser.add_argument("--verbose", action="store_true", help="Stream stage progress to stderr")
    parser.add_argument("--skip-tests", action="store_true", help="Exclude test directories from calibration")
    parser.add_argument("--no-settings-patch", action="store_true", help="Skip patching .claude/settings.json")

    args = parser.parse_args()

    result = InitResult()
    result.generated_date = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # Stage 1
    _log("Stage 1/10: validate_target", args.verbose)
    result.target = validate_target(args.target)

    # Stage 2
    _log("Stage 2/10: detect_languages", args.verbose)
    result.languages = detect_languages(result.target, args.verbose)

    # Stage 3
    _log("Stage 3/10: detect_frameworks", args.verbose)
    result.frameworks = detect_frameworks(result.target, args.verbose)

    # Stage 4
    _log("Stage 4/10: detect_existing_linters", args.verbose)
    result.existing_linters = detect_existing_linters(result.target, args.verbose)

    # Stage 5
    _log("Stage 5/10: detect_test_dirs", args.verbose)
    result.test_dirs = detect_test_dirs(result.target, args.verbose)

    # Stage 6
    _log("Stage 6/10: calibrate_thresholds", args.verbose)
    result.thresholds = calibrate_thresholds(
        result.target,
        strict=args.strict,
        skip_tests=args.skip_tests,
        verbose=args.verbose,
    )

    # Stage 7
    _log("Stage 7/10: smoke_test_tools", args.verbose)
    _, result.lizard_available = smoke_test_tools(
        allow_missing=args.allow_missing_tools,
        verbose=args.verbose,
    )

    # Stage 8
    _log("Stage 8/10: generate_hook_scripts", args.verbose)
    hooks_dir = args.out or str(Path(result.target) / ".claude" / "hooks")
    result.hooks_dir = generate_hook_scripts(
        hooks_dir,
        result.thresholds,
        result.test_dirs,
        force=args.force,
        verbose=args.verbose,
    )

    # Stage 9
    _log("Stage 9/10: patch_settings_json", args.verbose)
    result.settings_patched = patch_settings_json(
        result.target,
        result.hooks_dir,
        no_patch=args.no_settings_patch,
        verbose=args.verbose,
    )

    # Stage 10
    _log("Stage 10/10: validate_round_trip", args.verbose)
    validate_round_trip(result.hooks_dir, args.verbose)

    # Output report
    print(_format_report(result))


if __name__ == "__main__":
    main()
