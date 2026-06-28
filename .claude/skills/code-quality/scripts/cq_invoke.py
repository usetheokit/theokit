"""Shared helper to invoke `/code-quality` as a subprocess.

Used by:
  - `skills/plan-confidence/scripts/run_structural.py` — merges CQ verdict into
    plan-confidence's hard caps.
  - `skills/implement/scripts/run_validation.py` — gates `IMPLEMENTATION_COMPLETE`
    on CQ verdict (per ADR `0002-cq-gate-in-validate`).

The function returns the parsed JSON dict on success, or None on graceful
degradation (script missing, timeout, non-zero exit other than 0/1, malformed JSON).
Never raises — callers must handle the None case.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


def invoke(plan_slug: str, repo_root: Path, *, timeout_s: int = 600) -> dict | None:
    """Run `python3 .../run_code_quality.py {plan_slug} --no-audit-write --json-out -`.

    Forwards `CODE_QUALITY_NO_NETWORK` env when set.

    Returns parsed JSON dict on success, or None on failure (gracefully degraded).
    """
    script = repo_root / "skills" / "code-quality" / "scripts" / "run_code_quality.py"
    if not script.exists():
        # Fallback for repos that vendor under `.claude/skills/`.
        script = repo_root / ".claude" / "skills" / "code-quality" / "scripts" / "run_code_quality.py"
    if not script.exists():
        return None

    cmd = ["python3", str(script), plan_slug, "--no-audit-write", "--json-out", "-"]
    if os.environ.get("CODE_QUALITY_NO_NETWORK"):
        cmd.append("--no-network")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=str(repo_root),
            check=False,
        )
    except (FileNotFoundError, subprocess.SubprocessError, OSError):
        return None

    if result.returncode not in (0, 1):
        return None

    try:
        return json.loads(result.stdout)
    except (json.JSONDecodeError, ValueError):
        return None


def merge_verdict_into_plan_confidence(out: dict, cq_summary: dict) -> None:
    """Severity-tier-aware merge of CQ verdict into plan-confidence output.

    Tier mapping (consults cq_summary["score_cap"] AND ["verdict"]):

      cq_verdict          → cq_score_cap → action
      PASS                → 100          → no change
      PASS_WITH_CAVEATS   → 89           → cap at 89; SHIPPABLE → SHIPPABLE_WITH_CAVEATS
      FAIL_SOFT           → 70           → cap at 70; SHIPPABLE* → NON_SHIPPABLE
      FAIL_HARD           → 49           → force INVALID; cap at 49
      INVALID             → 0            → force INVALID; cap at 0 (golden rule § 1)

    The CQ `hard_caps_triggered` identifiers are always appended to the plan's
    list for audit visibility, regardless of severity tier.
    """
    cq_caps = list(cq_summary.get("hard_caps_triggered", []))
    if cq_caps:
        existing = list(out.get("hard_caps_triggered", []))
        for cap in cq_caps:
            if cap not in existing:
                existing.append(cap)
        out["hard_caps_triggered"] = existing

    cq_score_cap = cq_summary.get("score_cap", 100)
    cq_verdict = cq_summary.get("verdict", "UNKNOWN")
    if cq_score_cap >= 100:
        return

    out["final_score_after_caps"] = min(out.get("final_score_after_caps", 100), cq_score_cap)
    current = out.get("verdict", "SHIPPABLE")
    if cq_verdict in ("FAIL_HARD", "INVALID"):
        out["verdict"] = "INVALID"
    elif cq_verdict == "FAIL_SOFT":
        if current in ("SHIPPABLE", "SHIPPABLE_WITH_CAVEATS"):
            out["verdict"] = "NON_SHIPPABLE"
    elif cq_verdict == "PASS_WITH_CAVEATS":
        if current == "SHIPPABLE":
            out["verdict"] = "SHIPPABLE_WITH_CAVEATS"
