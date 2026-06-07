"""Portability tests — verify the skill works in any project layout."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).parent.parent
SETUP_SH = SKILL_ROOT / "setup.sh"


def _run_setup(target: Path, *flags: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(SETUP_SH), str(target), *flags],
        capture_output=True,
        text=True,
        check=False,
    )


def _make_minimal_plan(target: Path, slug: str = "demo") -> Path:
    plans_dir = target / ".claude" / "knowledge-base" / "plans"
    plans_dir.mkdir(parents=True, exist_ok=True)
    plan_path = plans_dir / f"{slug}-plan.md"
    plan_path.write_text(
        f"---\ntype: plan\nslug: {slug}\n---\n\n"
        f"# Plan: {slug}\n\n"
        f"> Version 1.0 — Toy plan. Follows SOLID + DRY. Files <= 500 LoC.\n\n"
        f"## ADRs\n\n### D1 — toy\n- Rationale: alternativa rejeitada.\n\n"
        f"## Coverage Matrix\n\n"
        f"| # | Gap | Task(s) | Resolution |\n"
        f"|---|-----|---------|------------|\n"
        f"| 1 | gap | T1.1 | done |\n\n"
        f"## Global Definition of Done\n\n- [ ] tests pass\n- [ ] lint clean\n",
        encoding="utf-8",
    )
    return plan_path


def test_setup_sh_exists_and_executable() -> None:
    assert SETUP_SH.exists()
    # On Unix, check executable bit
    assert SETUP_SH.stat().st_mode & 0o111


def test_setup_sh_help_works() -> None:
    proc = subprocess.run(
        ["bash", str(SETUP_SH), "--help"], capture_output=True, text=True, check=False
    )
    assert proc.returncode == 0
    assert "setup.sh" in proc.stdout.lower() or "install" in proc.stdout.lower()


def test_setup_into_fresh_directory() -> None:
    """Install into a brand-new directory; verify skill files copied."""
    with tempfile.TemporaryDirectory() as tmpdir:
        target = Path(tmpdir) / "fresh-project"
        target.mkdir()
        proc = _run_setup(target)
        assert proc.returncode == 0, f"setup failed: {proc.stderr}"
        # Verify skill present
        assert (target / ".claude" / "skills" / "plan-confidence" / "SKILL.md").exists()
        assert (
            target / ".claude" / "skills" / "plan-confidence" / "scripts" / "run_structural.py"
        ).exists()
        assert (target / ".claude" / "skills" / "plan-confidence" / "defaults").is_dir()


def test_run_structural_works_in_fresh_project() -> None:
    """E2E: install + score a synthetic plan in a fresh project (no .claude/rules/)."""
    with tempfile.TemporaryDirectory() as tmpdir:
        target = Path(tmpdir) / "e2e-project"
        target.mkdir()
        _run_setup(target)
        plan_path = _make_minimal_plan(target)

        runner = target / ".claude" / "skills" / "plan-confidence" / "scripts" / "run_structural.py"
        proc = subprocess.run(
            [sys.executable, str(runner), str(plan_path), "--no-warn"],
            capture_output=True,
            text=True,
            check=False,
        )
        assert proc.returncode == 0, f"runner failed: stderr={proc.stderr}, stdout={proc.stdout}"
        report = json.loads(proc.stdout)
        # Score should be high (well-formed plan with SOLID/DRY mentions)
        assert report["verdict"] in {"SHIPPABLE", "SHIPPABLE_WITH_CAVEATS"}
        # Compliance should fall back to defaults (no .claude/rules/)
        ac = report["sub_reports"]["architecture_compliance"]
        assert ac["fallback_to_defaults"] is True
        assert ac["project_rules_found_count"] > 0  # found defaults bundle
        # Principles cited got credit
        assert "SOLID" in ac["principles_cited"] or "DRY" in ac["principles_cited"]


def test_setup_does_not_clobber_existing_rules() -> None:
    """If target already has rules, setup --with-rules should NOT overwrite."""
    with tempfile.TemporaryDirectory() as tmpdir:
        target = Path(tmpdir) / "with-rules"
        target.mkdir()
        rules_dir = target / ".claude" / "rules"
        rules_dir.mkdir(parents=True)
        existing_thresholds = rules_dir / "plan-confidence-thresholds.txt"
        original_content = "# CUSTOM project thresholds — do not overwrite\n"
        existing_thresholds.write_text(original_content, encoding="utf-8")

        proc = _run_setup(target, "--with-rules")
        assert proc.returncode == 0
        assert "Already exists, skipping" in proc.stdout
        # Original content preserved
        assert existing_thresholds.read_text(encoding="utf-8") == original_content


def test_auto_detect_finds_project_root_via_walk_up() -> None:
    """The runner walks up to find .claude/ — works at any depth."""
    with tempfile.TemporaryDirectory() as tmpdir:
        target = Path(tmpdir) / "deep" / "nested" / "project"
        target.mkdir(parents=True)
        # Set up project structure
        _run_setup(target)
        plan_path = _make_minimal_plan(target, "depth-test")

        runner = target / ".claude" / "skills" / "plan-confidence" / "scripts" / "run_structural.py"
        proc = subprocess.run(
            [sys.executable, str(runner), str(plan_path), "--no-warn"],
            capture_output=True,
            text=True,
            check=False,
        )
        assert proc.returncode == 0
        report = json.loads(proc.stdout)
        assert "verdict" in report


def test_setup_with_rules_copies_templates() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        target = Path(tmpdir) / "with-rules-clean"
        target.mkdir()
        proc = _run_setup(target, "--with-rules")
        assert proc.returncode == 0
        rules_dir = target / ".claude" / "rules"
        assert (rules_dir / "plan-confidence-thresholds.txt").exists()
        assert (rules_dir / "plan-confidence-golden-rule.md").exists()
        assert (rules_dir / "plan-confidence-allowlist.txt").exists()


def test_portable_md_documents_install() -> None:
    portable_md = SKILL_ROOT / "PORTABLE.md"
    assert portable_md.exists()
    content = portable_md.read_text(encoding="utf-8")
    text_lower = content.lower()
    assert "quick install" in text_lower or "install" in text_lower
    assert "copy-paste" in text_lower or "cp -r" in content
    assert "setup.sh" in content


def test_skill_no_hard_coded_project_paths() -> None:
    """The skill scripts must NOT contain hard-coded project paths."""
    scripts = (SKILL_ROOT / "scripts").glob("*.py")
    for script in scripts:
        content = script.read_text(encoding="utf-8")
        # Should not have absolute paths pointing to a specific project
        assert "/home/" not in content, f"absolute home path in {script.name}"
        assert "/Users/" not in content, f"absolute Users path in {script.name}"
        # Project-specific references should be in comments only OR auto-detected
        # (not a strict requirement, but flag obvious cases)
        if "theo-code" in content:
            # Allowed only in comments
            for line_no, line in enumerate(content.splitlines(), start=1):
                if "theo-code" in line and not line.strip().startswith("#"):
                    pytest.fail(
                        f"{script.name}:{line_no} contains 'theo-code' outside a comment: {line}"
                    )


def test_templates_dir_has_example_files() -> None:
    templates = SKILL_ROOT / "templates"
    assert (templates / "plan-confidence-thresholds.example.txt").exists()
    assert (templates / "plan-confidence-golden-rule.example.md").exists()
    assert (templates / "plan-confidence-allowlist.example.txt").exists()


def test_example_templates_have_no_project_specific_entries() -> None:
    """Templates should be GENERIC — no theo-code-specific slugs."""
    templates = SKILL_ROOT / "templates"
    for ex_file in templates.glob("*.example.*"):
        content = ex_file.read_text(encoding="utf-8")
        # Should not reference specific plans from theo-code
        assert "theo-cli-cohesion" not in content, f"{ex_file.name} has theo-cli reference"
        assert "sota-gaps" not in content, f"{ex_file.name} has sota-gaps reference"
