"""T2.2 — /code-quality gate inside run_validation.py (ADR 0002)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).parent.parent / "scripts" / "run_validation.py"


def _run(slug: str, project_root: Path, extra: list[str] | None = None) -> tuple[int, dict]:
    cmd = [
        sys.executable,
        str(SCRIPT),
        slug,
        "--project-root",
        str(project_root),
        "--no-write-report",
    ]
    if extra:
        cmd.extend(extra)
    result = subprocess.run(cmd, capture_output=True, text=True)
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = {"raw": result.stdout, "stderr": result.stderr}
    return result.returncode, data


def _install_fake_cq(project_root: Path, *, verdict: str, score_cap: int, hard_caps: list[str] | None = None) -> None:
    """Plant a fake run_code_quality.py that prints the JSON we want and exits 0."""
    cq_dir = project_root / "skills" / "code-quality" / "scripts"
    cq_dir.mkdir(parents=True, exist_ok=True)
    body = {
        "verdict": verdict,
        "score_cap": score_cap,
        "hard_caps_triggered": hard_caps or [],
        "soft_caps_triggered": [],
        "languages_audited": ["python"],
    }
    payload = json.dumps(body)
    script = cq_dir / "run_code_quality.py"
    script.write_text(
        f"""#!/usr/bin/env python3
import sys
sys.stdout.write({payload!r})
sys.stdout.flush()
sys.exit(0)
""",
        encoding="utf-8",
    )


def test_no_code_quality_flag_skips_invocation(fake_project: Path) -> None:
    """--no-code-quality flag must skip the CQ gate entirely."""
    rc, data = _run("test-slug", fake_project, extra=["--no-code-quality"])
    assert rc == 0
    cq_check = next((c for c in data["checks"] if c.get("name") == "code_quality"), None)
    assert cq_check is not None
    assert cq_check["status"] == "SKIP"


def test_validation_passes_when_cq_unavailable(fake_project: Path) -> None:
    """When CQ script is not installed, validation degrades gracefully (no FAIL)."""
    rc, data = _run("test-slug", fake_project)
    # No CQ script, no package.json — same PARTIAL/PASS result as before the gate.
    assert rc == 0
    cq_check = next((c for c in data["checks"] if c.get("name") == "code_quality"), None)
    assert cq_check is not None
    assert cq_check["status"] in ("SKIP", "N/A")


def test_validation_fails_on_cq_fail_hard(fake_project: Path) -> None:
    """Fake CQ returning FAIL_HARD must force validation overall=FAIL and exit 1."""
    _install_fake_cq(fake_project, verdict="FAIL_HARD", score_cap=49, hard_caps=["symbol_fabrication_python"])
    rc, data = _run("test-slug", fake_project)
    assert rc == 1
    assert data["overall_status"] == "FAIL"
    cq_check = next((c for c in data["checks"] if c.get("name") == "code_quality"), None)
    assert cq_check["status"] == "FAIL"
    assert cq_check["verdict"] == "FAIL_HARD"


def test_validation_fails_on_cq_invalid(fake_project: Path) -> None:
    """INVALID verdict from CQ also fails validation."""
    _install_fake_cq(fake_project, verdict="INVALID", score_cap=0, hard_caps=["code_quality_golden_rule_missing"])
    rc, _ = _run("test-slug", fake_project)
    assert rc == 1


def test_validation_passes_with_cq_caveats(fake_project: Path) -> None:
    """PASS_WITH_CAVEATS is logged but does NOT fail the gate."""
    _install_fake_cq(fake_project, verdict="PASS_WITH_CAVEATS", score_cap=89)
    rc, data = _run("test-slug", fake_project)
    assert rc == 0
    cq_check = next((c for c in data["checks"] if c.get("name") == "code_quality"), None)
    # The status must surface that the verdict carries caveats — explicit, not silent.
    assert cq_check["status"] in ("PASS", "PARTIAL", "WARN")
    assert cq_check["verdict"] == "PASS_WITH_CAVEATS"


def test_validation_warns_on_fail_soft(fake_project: Path) -> None:
    """FAIL_SOFT registers a WARNING but does NOT block — per ADR D2."""
    _install_fake_cq(fake_project, verdict="FAIL_SOFT", score_cap=70, hard_caps=["soft_cap_orphan_export_python"])
    rc, data = _run("test-slug", fake_project)
    assert rc == 0  # not blocking
    cq_check = next((c for c in data["checks"] if c.get("name") == "code_quality"), None)
    assert cq_check["verdict"] == "FAIL_SOFT"
    # FAIL_SOFT must be visible, not silently green:
    assert cq_check["status"] in ("WARN", "PARTIAL")


def test_validation_passes_with_cq_pass(fake_project: Path) -> None:
    """Plain PASS from CQ → no impact on validation outcome."""
    _install_fake_cq(fake_project, verdict="PASS", score_cap=100)
    rc, data = _run("test-slug", fake_project)
    assert rc == 0
    cq_check = next((c for c in data["checks"] if c.get("name") == "code_quality"), None)
    assert cq_check["status"] == "PASS"
    assert cq_check["verdict"] == "PASS"
