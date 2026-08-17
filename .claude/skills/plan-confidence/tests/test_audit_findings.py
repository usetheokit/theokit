"""Audit-found regression tests — lock in fixes for issues found during honest review."""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

SKILL_ROOT = Path(__file__).parent.parent
SETUP_SH = SKILL_ROOT / "setup.sh"


def test_defaults_have_no_theo_code_leak() -> None:
    """AUDIT FINDING #2: defaults/*.md must NOT name 'theo-code' (would leak source project)."""
    defaults_dir = SKILL_ROOT / "defaults"
    for md_file in defaults_dir.glob("*.md"):
        content = md_file.read_text(encoding="utf-8")
        assert "theo-code" not in content.lower(), (
            f"{md_file.name} mentions 'theo-code' — defaults must be project-agnostic"
        )
        assert "usetheo" not in content.lower(), (
            f"{md_file.name} mentions 'usetheo' — defaults must be project-agnostic"
        )


def test_setup_sh_rejects_source_equals_target() -> None:
    """AUDIT FINDING #1: setup.sh must not overwrite itself when target == source project."""
    # The source's project root is .claude/skills/plan-confidence/../../.. -> the project root.
    # Calling setup.sh with target == that path must be a no-op.
    source_project_root = SKILL_ROOT.parent.parent.parent
    proc = subprocess.run(
        ["bash", str(SETUP_SH), str(source_project_root)],
        capture_output=True,
        text=True,
        check=False,
    )
    # Must NOT copy (return non-zero OR specific message)
    output = proc.stdout + proc.stderr
    assert (
        "Nothing to copy" in output
        or "would overwrite source" in output
        or "same project" in output
    ), f"setup.sh did not detect source==target. Output:\n{output}"


def test_setup_sh_rejects_target_inside_source_claude() -> None:
    """AUDIT FINDING #1b: target inside source/.claude/ would corrupt source."""
    source_claude_dir = SKILL_ROOT.parent.parent  # .claude/
    # Try target = source/.claude/skills/ (inside source .claude/)
    inside = source_claude_dir / "skills"
    proc = subprocess.run(
        ["bash", str(SETUP_SH), str(inside)],
        capture_output=True,
        text=True,
        check=False,
    )
    # Must fail with non-zero
    assert proc.returncode != 0, (
        f"setup.sh accepted target inside source. stdout: {proc.stdout}, stderr: {proc.stderr}"
    )


def test_setup_sh_succeeds_for_legit_external_target() -> None:
    """Sanity: setup.sh still works for legitimate external targets."""
    with tempfile.TemporaryDirectory() as tmpdir:
        target = Path(tmpdir) / "legit-project"
        target.mkdir()
        proc = subprocess.run(
            ["bash", str(SETUP_SH), str(target)],
            capture_output=True,
            text=True,
            check=False,
        )
        assert proc.returncode == 0
        assert (target / ".claude" / "skills" / "plan-confidence" / "SKILL.md").exists()


def test_setup_sh_fails_loudly_without_pyyaml() -> None:
    """GAP-1 FIX: setup.sh must exit with non-zero + clear message when PyYAML missing.

    We simulate PyYAML absence by running the verify step manually in an env where
    `python3 -c "import yaml"` would fail (we use a wrapper script).
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        target = Path(tmpdir) / "no-yaml"
        target.mkdir()
        # Create a fake python3 that refuses to import yaml
        fake_bin = Path(tmpdir) / "fakebin"
        fake_bin.mkdir()
        fake_python = fake_bin / "python3"
        fake_python.write_text(
            "#!/usr/bin/env bash\n"
            'if [[ "$*" == *"import yaml"* ]]; then exit 1; fi\n'
            'if [[ "$*" == *"sys.version_info"* ]]; then echo 1; exit 0; fi\n'
            'if [[ "$*" == *"--version"* ]]; then echo "Python 3.10.12 (fake)"; exit 0; fi\n'
            '# Otherwise pretend success\n'
            "exit 0\n"
        )
        fake_python.chmod(0o755)

        env = {
            "PATH": f"{fake_bin}:/usr/bin:/bin",
            "HOME": tmpdir,
        }
        proc = subprocess.run(
            ["bash", str(SETUP_SH), str(target)],
            capture_output=True,
            text=True,
            check=False,
            env=env,
        )
        # Must exit non-zero (specifically 3 per setup.sh convention)
        assert proc.returncode == 3, (
            f"expected exit 3 for PyYAML missing, got {proc.returncode}.\n"
            f"stdout: {proc.stdout}\nstderr: {proc.stderr}"
        )
        # Clear remediation message
        combined = proc.stdout + proc.stderr
        assert "PyYAML" in combined
        assert "pip install" in combined.lower() or "install" in combined.lower()


def test_walk_up_picks_closest_claude() -> None:
    """GAP-3 FIX: when multiple .claude/ dirs exist in hierarchy, pick the CLOSEST one.

    Layout:
        /tmp/outer-project/
          .claude/                    <-- outer marker
          inner-project/
            .claude/                  <-- inner marker (closest to skill)
              skills/plan-confidence/scripts/run_structural.py
    """
    import sys

    with tempfile.TemporaryDirectory() as tmpdir:
        outer = Path(tmpdir) / "outer-project"
        outer_claude = outer / ".claude"
        outer_claude.mkdir(parents=True)
        (outer_claude / "rules").mkdir()
        (outer_claude / "rules" / "outer-rule.md").write_text("outer", encoding="utf-8")

        inner = outer / "inner-project"
        inner_claude = inner / ".claude"
        scripts = inner_claude / "skills" / "plan-confidence" / "scripts"
        scripts.mkdir(parents=True)
        defaults = inner_claude / "skills" / "plan-confidence" / "defaults"
        defaults.mkdir(parents=True)
        (inner_claude / "rules").mkdir()
        (inner_claude / "rules" / "inner-rule.md").write_text("inner", encoding="utf-8")

        # Copy run_structural + deps to inner skill dir
        src_scripts = SKILL_ROOT / "scripts"
        for py in src_scripts.glob("*.py"):
            (scripts / py.name).write_bytes(py.read_bytes())
        # Copy defaults so check_architecture_compliance has fallback
        src_defaults = SKILL_ROOT / "defaults"
        for md in src_defaults.glob("*.md"):
            (defaults / md.name).write_bytes(md.read_bytes())

        # Now import run_structural from the INNER skill and verify PROJECT_ROOT == inner
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                f"import sys; sys.path.insert(0, '{scripts}'); "
                "from run_structural import PROJECT_ROOT; print(PROJECT_ROOT)",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, f"import failed: {result.stderr}"
        detected = Path(result.stdout.strip())
        # Closest .claude/ is inner-project/.claude/, so PROJECT_ROOT == inner
        assert detected == inner.resolve(), (
            f"walk-up picked WRONG project: detected={detected}, expected={inner.resolve()}"
        )


def test_portable_md_documents_windows_limitation() -> None:
    """GAP-2 FIX: PORTABLE.md must explicitly mention Windows support status."""
    portable_md = SKILL_ROOT / "PORTABLE.md"
    content = portable_md.read_text(encoding="utf-8")
    text_lower = content.lower()
    # Must mention Windows + WSL
    assert "windows" in text_lower
    assert "wsl" in text_lower
    # Must mention setup.sh is bash-only
    assert "bash" in text_lower
