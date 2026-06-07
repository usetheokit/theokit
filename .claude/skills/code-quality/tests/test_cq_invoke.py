"""Tests for cq_invoke shared helper (R4.x — harden-fabrication-and-cq-gate T2.1).

Three RED tests promised by the plan, addressing the
`impljudge-cq-helper-red-tests-missing` finding raised by judge-codex on
2026-06-04.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import cq_invoke  # noqa: E402


def test_invoke_returns_none_when_script_missing(tmp_path: Path) -> None:
    """`cq_invoke.invoke` MUST return None gracefully when run_code_quality.py is absent.

    Repository roots without `/code-quality` installed (or with the path
    layout shifted) MUST NOT crash plan-confidence — graceful degradation
    is the contract documented in skills/code-quality/scripts/cq_invoke.py.
    """
    # tmp_path has no skills/code-quality/scripts/run_code_quality.py
    # and no .claude/skills/... fallback either.
    result = cq_invoke.invoke("any-slug", tmp_path)
    assert result is None


def test_invoke_parses_json_output(tmp_path: Path) -> None:
    """`cq_invoke.invoke` MUST parse and return the JSON dict that run_code_quality emits.

    Simulates a real run by planting a fake run_code_quality.py that prints a
    well-formed JSON payload to stdout and exits 0. The helper must capture
    + parse it without losing fields.
    """
    cq_scripts = tmp_path / "skills" / "code-quality" / "scripts"
    cq_scripts.mkdir(parents=True)
    payload = {
        "verdict": "PASS_WITH_CAVEATS",
        "score_cap": 89,
        "hard_caps_triggered": [],
        "soft_caps_triggered": ["soft_cap_orphan_export_python"],
        "languages_audited": ["python"],
    }
    fake_script = cq_scripts / "run_code_quality.py"
    fake_script.write_text(
        "#!/usr/bin/env python3\n"
        "import sys\n"
        f"sys.stdout.write({json.dumps(json.dumps(payload))})\n"
        "sys.stdout.flush()\n"
        "sys.exit(0)\n",
        encoding="utf-8",
    )

    result = cq_invoke.invoke("test-slug", tmp_path)
    assert result is not None
    assert result["verdict"] == "PASS_WITH_CAVEATS"
    assert result["score_cap"] == 89
    assert result["soft_caps_triggered"] == ["soft_cap_orphan_export_python"]
    assert result["languages_audited"] == ["python"]


def test_invoke_handles_timeout(tmp_path: Path) -> None:
    """`cq_invoke.invoke` MUST return None when subprocess times out.

    Simulates a hung run_code_quality.py via a fake script that sleeps
    longer than the supplied timeout. invoke() must catch the
    TimeoutExpired exception and degrade to None — never raise to caller.
    """
    cq_scripts = tmp_path / "skills" / "code-quality" / "scripts"
    cq_scripts.mkdir(parents=True)
    fake_script = cq_scripts / "run_code_quality.py"
    fake_script.write_text(
        "#!/usr/bin/env python3\n"
        "import time, sys\n"
        "time.sleep(30)\n"
        "sys.exit(0)\n",
        encoding="utf-8",
    )

    # Force timeout of 1 second; fake script sleeps 30s.
    result = cq_invoke.invoke("test-slug", tmp_path, timeout_s=1)
    assert result is None


def test_invoke_handles_malformed_json(tmp_path: Path) -> None:
    """`cq_invoke.invoke` MUST return None when run_code_quality emits non-JSON.

    Defends against an upstream tool emitting an error trailer or human-readable
    text instead of the contracted JSON payload — the helper must not propagate
    a JSONDecodeError to plan-confidence.
    """
    cq_scripts = tmp_path / "skills" / "code-quality" / "scripts"
    cq_scripts.mkdir(parents=True)
    fake_script = cq_scripts / "run_code_quality.py"
    fake_script.write_text(
        "#!/usr/bin/env python3\n"
        "import sys\n"
        "sys.stdout.write('not-valid-json-output')\n"
        "sys.exit(0)\n",
        encoding="utf-8",
    )

    result = cq_invoke.invoke("test-slug", tmp_path)
    assert result is None


def test_invoke_handles_nonzero_exit_other_than_one(tmp_path: Path) -> None:
    """invoke() accepts exit 0 and exit 1 (real verdicts can be exit 1 = FAIL).
    Other non-zero exits (2 = invocation error, etc.) MUST return None.
    """
    cq_scripts = tmp_path / "skills" / "code-quality" / "scripts"
    cq_scripts.mkdir(parents=True)
    fake_script = cq_scripts / "run_code_quality.py"
    fake_script.write_text(
        "#!/usr/bin/env python3\n"
        "import sys\n"
        "sys.stdout.write('{}')\n"
        "sys.exit(2)\n",
        encoding="utf-8",
    )

    result = cq_invoke.invoke("test-slug", tmp_path)
    assert result is None


def test_invoke_forwards_no_network_env(tmp_path: Path) -> None:
    """invoke() MUST forward CODE_QUALITY_NO_NETWORK env via --no-network flag."""
    cq_scripts = tmp_path / "skills" / "code-quality" / "scripts"
    cq_scripts.mkdir(parents=True)
    log_file = tmp_path / "args.log"
    fake_script = cq_scripts / "run_code_quality.py"
    fake_script.write_text(
        f"#!/usr/bin/env python3\n"
        f"import json, sys\n"
        f"open({str(log_file)!r}, 'w').write(json.dumps(sys.argv))\n"
        f"sys.stdout.write('{{}}')\n"
        f"sys.exit(0)\n",
        encoding="utf-8",
    )

    with patch.dict(os.environ, {"CODE_QUALITY_NO_NETWORK": "1"}):
        cq_invoke.invoke("test-slug", tmp_path)

    args = json.loads(log_file.read_text())
    assert "--no-network" in args, f"expected --no-network in argv; got {args}"


def test_merge_verdict_pass_no_change() -> None:
    """`merge_verdict_into_plan_confidence`: PASS (score_cap 100) MUST not change the plan verdict."""
    out = {"verdict": "SHIPPABLE", "final_score_after_caps": 95.0, "hard_caps_triggered": []}
    cq = {"verdict": "PASS", "score_cap": 100, "hard_caps_triggered": []}
    cq_invoke.merge_verdict_into_plan_confidence(out, cq)
    assert out["verdict"] == "SHIPPABLE"
    assert out["final_score_after_caps"] == 95.0


def test_merge_verdict_fail_hard_forces_invalid() -> None:
    """`merge_verdict_into_plan_confidence`: FAIL_HARD MUST force verdict=INVALID and cap score."""
    out = {"verdict": "SHIPPABLE", "final_score_after_caps": 95.0, "hard_caps_triggered": []}
    cq = {
        "verdict": "FAIL_HARD",
        "score_cap": 49,
        "hard_caps_triggered": ["symbol_fabrication_python"],
    }
    cq_invoke.merge_verdict_into_plan_confidence(out, cq)
    assert out["verdict"] == "INVALID"
    assert out["final_score_after_caps"] == 49
    assert "symbol_fabrication_python" in out["hard_caps_triggered"]


def test_merge_verdict_with_caveats_downgrades_shippable() -> None:
    """PASS_WITH_CAVEATS MUST downgrade SHIPPABLE → SHIPPABLE_WITH_CAVEATS and cap at 89."""
    out = {"verdict": "SHIPPABLE", "final_score_after_caps": 95.0, "hard_caps_triggered": []}
    cq = {"verdict": "PASS_WITH_CAVEATS", "score_cap": 89, "hard_caps_triggered": []}
    cq_invoke.merge_verdict_into_plan_confidence(out, cq)
    assert out["verdict"] == "SHIPPABLE_WITH_CAVEATS"
    assert out["final_score_after_caps"] == 89


def test_merge_verdict_fail_soft_downgrades_to_nonshippable() -> None:
    """FAIL_SOFT MUST downgrade SHIPPABLE / SHIPPABLE_WITH_CAVEATS → NON_SHIPPABLE."""
    out = {"verdict": "SHIPPABLE", "final_score_after_caps": 95.0, "hard_caps_triggered": []}
    cq = {"verdict": "FAIL_SOFT", "score_cap": 70, "hard_caps_triggered": []}
    cq_invoke.merge_verdict_into_plan_confidence(out, cq)
    assert out["verdict"] == "NON_SHIPPABLE"
    assert out["final_score_after_caps"] == 70
