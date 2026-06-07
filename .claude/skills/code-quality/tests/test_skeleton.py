"""T0.3 — Skill skeleton sanity tests.

RED → GREEN tests asserting the skill directory layout is correct and the
detector modules are importable + expose the BaseDetector interface.
"""
from __future__ import annotations

import importlib
import inspect
from pathlib import Path

import pytest
import yaml


def test_skill_md_exists(skill_root: Path) -> None:
    """SKILL.md MUST exist at the skill root."""
    assert (skill_root / "SKILL.md").is_file()


def test_skill_md_frontmatter_parseable(skill_root: Path) -> None:
    """SKILL.md MUST have YAML frontmatter with required fields."""
    content = (skill_root / "SKILL.md").read_text(encoding="utf-8")
    assert content.startswith("---\n"), "SKILL.md must start with --- frontmatter"

    end = content.find("\n---\n", 4)
    assert end > 0, "SKILL.md frontmatter must close with ---"

    frontmatter = yaml.safe_load(content[4:end])
    assert frontmatter["name"] == "code-quality"
    assert isinstance(frontmatter["description"], str) and len(frontmatter["description"]) > 50
    assert frontmatter["user-invocable"] is True
    assert "Read" in frontmatter["allowed-tools"]
    assert "argument-hint" in frontmatter


def test_portable_md_exists(skill_root: Path) -> None:
    """PORTABLE.md MUST exist (standalone installation doc)."""
    assert (skill_root / "PORTABLE.md").is_file()


def test_pyproject_toml_exists(skill_root: Path) -> None:
    """pyproject.toml MUST exist with required deps."""
    assert (skill_root / "pyproject.toml").is_file()


def test_pyproject_declares_required_deps(skill_root: Path) -> None:
    """pyproject.toml MUST declare tree-sitter, requests, pyyaml, pytest."""
    content = (skill_root / "pyproject.toml").read_text(encoding="utf-8").lower()
    for dep in ("tree-sitter", "requests", "pyyaml", "pytest"):
        assert dep in content, f"pyproject.toml missing dep: {dep}"


def test_setup_sh_exists(skill_root: Path) -> None:
    """setup.sh MUST exist (installer entry-point)."""
    setup = skill_root / "setup.sh"
    assert setup.is_file()


def test_scripts_package_importable(skill_root: Path) -> None:
    """scripts/ MUST be an importable Python package."""
    assert (skill_root / "scripts" / "__init__.py").is_file()


def test_detector_modules_present(skill_root: Path) -> None:
    """All 4 detector modules MUST exist under scripts/detectors/."""
    detectors = skill_root / "scripts" / "detectors"
    assert (detectors / "__init__.py").is_file()
    for lang in ("python", "typescript", "rust", "go"):
        assert (detectors / f"{lang}.py").is_file(), f"missing detector for {lang}"


def _import_detector(name: str):
    """Helper that imports scripts.detectors.{name}."""
    return importlib.import_module(f"scripts.detectors.{name}")


def test_detector_modules_importable() -> None:
    """Each detector module MUST be importable without side-effects."""
    for lang in ("python", "typescript", "rust", "go"):
        module = _import_detector(lang)
        assert module is not None


def test_detectors_expose_base_detector_subclass() -> None:
    """Each detector MUST expose a class named {Language}Detector subclassing BaseDetector."""
    base = importlib.import_module("scripts.detectors").BaseDetector
    for lang in ("python", "typescript", "rust", "go"):
        module = _import_detector(lang)
        cls_name = f"{lang.capitalize()}Detector"
        cls = getattr(module, cls_name, None)
        assert cls is not None, f"{lang}.py missing {cls_name}"
        assert inspect.isclass(cls)
        assert issubclass(cls, base), f"{cls_name} is not a BaseDetector subclass"


def test_base_detector_declares_required_methods() -> None:
    """BaseDetector MUST declare 4 abstract-or-stub methods."""
    base = importlib.import_module("scripts.detectors").BaseDetector
    for method in (
        "detect_dead_code",
        "detect_symbol_fabrication",
        "detect_orphan_exports",
        "detect_mutation_score",
    ):
        assert hasattr(base, method), f"BaseDetector missing method: {method}"


def test_base_detector_methods_raise_not_implemented() -> None:
    """Each BaseDetector method MUST raise NotImplementedError when invoked on the base class."""
    base_cls = importlib.import_module("scripts.detectors").BaseDetector
    instance = base_cls()
    methods = [
        ("detect_dead_code", (Path("/tmp"),)),
        ("detect_symbol_fabrication", ([Path("/tmp/x.py")],)),
        ("detect_orphan_exports", (Path("/tmp"),)),
        ("detect_mutation_score", ([Path("/tmp/x.py")],)),
    ]
    for method, args in methods:
        with pytest.raises(NotImplementedError):
            getattr(instance, method)(*args)


def test_templates_report_skeleton_exists(skill_root: Path) -> None:
    """templates/code-quality-report.md MUST exist (filled in T5.3)."""
    assert (skill_root / "templates" / "code-quality-report.md").is_file()


def test_defaults_present(skill_root: Path) -> None:
    """defaults/ MUST contain fallback copies of thresholds + languages."""
    defaults = skill_root / "defaults"
    assert (defaults / "thresholds.txt").is_file()
    assert (defaults / "languages.txt").is_file()


def test_entrypoint_run_code_quality_exists(skill_root: Path) -> None:
    """scripts/run_code_quality.py MUST exist (implementation in T5.1)."""
    assert (skill_root / "scripts" / "run_code_quality.py").is_file()
