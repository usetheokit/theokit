#!/usr/bin/env python3
"""Final validation gate for /implement halt-loop.

Runs (and gates on):
  - npm test         (skip if package.json absent — pre-code phase)
  - npm run typecheck
  - npm run lint
  - npm run test:coverage (≥ 90% on changed files; 100% on critical paths)
  - Wiring summary — aggregates check_wiring.py per changed symbol
  - Code-quality (per ADR 0002): invokes /code-quality and gates on verdict.
    FAIL_HARD/INVALID → validation FAIL (exit 1).
    FAIL_SOFT/PASS_WITH_CAVEATS → WARN, not blocking.
    PASS → no impact.
    Override with --no-code-quality (escape for pre-code / CI without the skill).

Outputs JSON validation report. Saves a markdown summary at:
  .claude/knowledge-base/reviews/{slug}-implement-validate-{date}.md

Exit codes:
  0 — All gates PASS or N/A
  1 — At least one gate FAIL (do NOT handoff to cycle-review)
  2 — Error (project root not found, slug missing, etc.)
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from diff_symbols import added_symbols_from_shas, shas_from_progress
from wiring_recheck import recheck_pillar_a


def _find_project_root(start: Path) -> Path:
    current = start.resolve()
    for _ in range(20):
        if (current / ".claude").exists() or (current / ".git").exists():
            return current
        if current == current.parent:
            break
        current = current.parent
    return start.resolve()


def _has_package_json(project_root: Path) -> bool:
    return (project_root / "package.json").exists()


def _has_npm_script(project_root: Path, script: str) -> bool:
    pkg = project_root / "package.json"
    if not pkg.exists():
        return False
    try:
        data = json.loads(pkg.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError:
        return False
    return script in data.get("scripts", {})


def _run_command(cmd: list[str], cwd: Path, timeout: int = 300) -> dict[str, Any]:
    try:
        result = subprocess.run(
            cmd,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return {
            "exit_code": result.returncode,
            "stdout_tail": result.stdout[-500:] if result.stdout else "",
            "stderr_tail": result.stderr[-500:] if result.stderr else "",
        }
    except subprocess.TimeoutExpired:
        return {"exit_code": -1, "error": f"timeout after {timeout}s"}
    except FileNotFoundError as exc:
        return {"exit_code": -1, "error": f"command not found: {exc}"}


def check_npm_test(project_root: Path) -> dict[str, Any]:
    if not _has_package_json(project_root):
        return {"name": "npm test", "status": "SKIP", "reason": "package.json absent — pre-code phase"}
    if not _has_npm_script(project_root, "test"):
        return {"name": "npm test", "status": "SKIP", "reason": "no 'test' script in package.json"}
    result = _run_command(["npm", "test", "--silent"], project_root, timeout=600)
    if result.get("exit_code") == 0:
        return {"name": "npm test", "status": "PASS"}
    return {
        "name": "npm test",
        "status": "FAIL",
        "exit_code": result.get("exit_code"),
        "stderr_tail": result.get("stderr_tail", result.get("error", "")),
    }


def check_npm_typecheck(project_root: Path) -> dict[str, Any]:
    if not _has_package_json(project_root):
        return {"name": "npm run typecheck", "status": "SKIP", "reason": "package.json absent — pre-code phase"}
    if not _has_npm_script(project_root, "typecheck"):
        # Fallback: run tsc --noEmit
        if (project_root / "tsconfig.json").exists():
            result = _run_command(["npx", "--no", "tsc", "--noEmit"], project_root, timeout=300)
            if result.get("exit_code") == 0:
                return {"name": "tsc --noEmit (fallback)", "status": "PASS"}
            return {
                "name": "tsc --noEmit (fallback)",
                "status": "FAIL",
                "exit_code": result.get("exit_code"),
                "stderr_tail": result.get("stderr_tail", "")[:500],
            }
        return {"name": "typecheck", "status": "SKIP", "reason": "no 'typecheck' script AND no tsconfig.json"}
    result = _run_command(["npm", "run", "typecheck", "--silent"], project_root, timeout=300)
    if result.get("exit_code") == 0:
        return {"name": "npm run typecheck", "status": "PASS"}
    return {
        "name": "npm run typecheck",
        "status": "FAIL",
        "exit_code": result.get("exit_code"),
        "stderr_tail": result.get("stderr_tail", result.get("error", "")),
    }


def check_npm_lint(project_root: Path) -> dict[str, Any]:
    if not _has_package_json(project_root):
        return {"name": "npm run lint", "status": "SKIP", "reason": "package.json absent — pre-code phase"}
    if not _has_npm_script(project_root, "lint"):
        return {"name": "npm run lint", "status": "SKIP", "reason": "no 'lint' script in package.json"}
    result = _run_command(["npm", "run", "lint", "--silent"], project_root, timeout=180)
    if result.get("exit_code") == 0:
        return {"name": "npm run lint", "status": "PASS"}
    return {
        "name": "npm run lint",
        "status": "FAIL",
        "exit_code": result.get("exit_code"),
        "stderr_tail": result.get("stderr_tail", result.get("error", "")),
    }


def check_coverage(project_root: Path) -> dict[str, Any]:
    """Run `npm run test:coverage` and gate on exit code.

    IMPORTANT HONESTY NOTE: this gate ONLY enforces that the coverage command
    exits successfully. It does NOT parse coverage reports (lcov, json-summary)
    to verify the ≥ 90% changed-files / 100% critical-paths thresholds promised
    in SKILL.md. The threshold parsing depends on:
      - the project shipping a coverage reporter (lcov-reporter, json-summary)
      - knowing which files are "changed" vs "critical path" (requires plan metadata)
    Both deferred until the project has a working `src/` to instrument.
    Until then, the threshold claim is honored by the test runner's own
    `--coverage --coverage-threshold` flag (if configured); this gate only
    asserts the command ran. Cycle-implement.md soft gate "Coverage < 100% on
    critical path" is currently advisory, not enforced here.
    """
    if not _has_package_json(project_root):
        return {"name": "coverage", "status": "SKIP", "reason": "package.json absent — pre-code phase"}
    if not _has_npm_script(project_root, "test:coverage"):
        return {"name": "coverage", "status": "SKIP", "reason": "no 'test:coverage' script in package.json"}
    result = _run_command(["npm", "run", "test:coverage", "--silent"], project_root, timeout=600)
    if result.get("exit_code") == 0:
        return {
            "name": "npm run test:coverage",
            "status": "PASS",
            "note": "Exit-code gate only — coverage thresholds NOT parsed by this script (see docstring).",
        }
    return {
        "name": "npm run test:coverage",
        "status": "FAIL",
        "exit_code": result.get("exit_code"),
        "stderr_tail": result.get("stderr_tail", result.get("error", "")),
    }


def _read_progress(project_root: Path, slug: str) -> dict[str, Any] | None:
    path = project_root / ".claude" / "knowledge-base" / "implementations" / f".progress-{slug}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError:
        return None


def wiring_summary(project_root: Path, slug: str) -> dict[str, Any]:
    """Re-verify wiring pillar (a) INDEPENDENTLY — never trust the progress file.

    The pillar (a) status is computed by deriving the public symbols actually added
    in the committed diffs (`diff_symbols`) and RE-RUNNING `check_wiring.py` on each
    (`wiring_recheck`). The `wiring` field the halt-loop wrote into the progress file
    is treated as a CLAIM to be audited, not as evidence: a task self-reporting
    `wiring.a == "pass"` while the recheck finds a real pillar (a) FAIL is flagged as
    fabricated evidence (Unbreakable Rule 3 — the skill must never fabricate wiring).
    """
    progress = _read_progress(project_root, slug)
    if progress is None:
        return {
            "name": "wiring_triad",
            "status": "SKIP",
            "reason": "no progress file found — implement may not have been invoked",
        }

    tasks = progress.get("tasks", []) if isinstance(progress, dict) else progress
    if not isinstance(tasks, list):
        tasks = []

    # Self-reported claims (audited below, never trusted as the verdict source).
    self_reported_a_pass = sum(
        1 for t in tasks if isinstance(t, dict) and t.get("wiring", {}).get("a") == "pass"
    )

    # Independent verification: derive symbols from the real diff, re-run the checker.
    shas = shas_from_progress(progress) if isinstance(progress, dict) else []
    symbols = added_symbols_from_shas(project_root, shas)
    recheck = recheck_pillar_a(project_root, symbols)

    base = {
        "name": "wiring_triad",
        "total_tasks": len(tasks),
        "self_reported_pillar_a_pass": self_reported_a_pass,
        "verification": "independent_recheck",
        "symbols_derived": recheck.symbols_checked,
        "symbols_resolved": recheck.symbols_resolved,
        "pillar_a_fails": recheck.pillar_a_fails,
        "pillar_a_fail_symbols": list(recheck.fail_symbols),
    }

    if recheck.pillar_a_fails > 0:
        result = {**base, "status": "FAIL"}
        if self_reported_a_pass > 0:
            # The progress file claims pillar (a) passed, yet an independent recheck
            # found uncalled symbols. That gap IS the fabrication this gate exists to
            # catch — surface it loudly so it cannot be waved through as a flake.
            result["fabricated_wiring_evidence"] = True
            result["reason"] = (
                f"Progress self-reports {self_reported_a_pass} task(s) with pillar (a) "
                f"pass, but independent recheck found {recheck.pillar_a_fails} uncalled "
                f"symbol(s): {', '.join(recheck.fail_symbols)}. Self-reported wiring "
                "evidence is not trustworthy."
            )
        else:
            result["reason"] = (
                f"Independent recheck found {recheck.pillar_a_fails} uncalled "
                f"symbol(s): {', '.join(recheck.fail_symbols)}"
            )
        return result

    if recheck.symbols_resolved == 0:
        # Nothing could be independently verified (pre-code phase, no SHAs, or
        # symbols not resolvable in the tree). Do NOT report PASS off self-claims —
        # report N/A honestly so the gate never launders an unverified claim.
        return {
            **base,
            "status": "N/A",
            "reason": (
                "No public symbols could be independently re-verified from the "
                "committed diffs (no SHAs, git unavailable, or derived names not "
                "found in the source tree). Pillar (a) NOT independently confirmed."
            ),
        }

    return {**base, "status": "PASS"}


def check_code_quality(project_root: Path, plan_slug: str, *, skip: bool = False) -> dict[str, Any]:
    """Invoke /code-quality and translate its verdict into a validation check.

    Per ADR 0002 (cq-gate-in-validate):
      - PASS              → check.status = PASS
      - PASS_WITH_CAVEATS → check.status = WARN (not blocking)
      - FAIL_SOFT         → check.status = WARN (not blocking)
      - FAIL_HARD         → check.status = FAIL (blocks IMPLEMENTATION_COMPLETE)
      - INVALID           → check.status = FAIL
      - script missing / parse error → SKIP (graceful — do NOT block when CQ is
        not installed)
    """
    if skip:
        return {
            "name": "code_quality",
            "status": "SKIP",
            "reason": "--no-code-quality flag set",
        }

    # cq_invoke is a sibling skill helper — import it from this skill's neighbor in
    # the `plan` repo, NOT from the consumer project_root (which may have neither).
    # Sibling layout: skills/implement/scripts/run_validation.py
    #              ↳ skills/code-quality/scripts/cq_invoke.py
    cq_invoke_dir = Path(__file__).resolve().parent.parent.parent / "code-quality" / "scripts"
    sys.path.insert(0, str(cq_invoke_dir))
    try:
        import cq_invoke  # type: ignore[import-not-found]
    except ImportError:
        return {
            "name": "code_quality",
            "status": "SKIP",
            "reason": "cq_invoke helper not importable",
        }
    finally:
        # Don't leak the helper dir into sys.path for the rest of the process.
        if sys.path and sys.path[0] == str(cq_invoke_dir):
            sys.path.pop(0)

    # invoke() may itself fail (CQ skill not installed, runtime error). Per ADR 0002
    # the CQ gate degrades to SKIP when unavailable — it must never crash validation.
    try:
        summary = cq_invoke.invoke(plan_slug, project_root)
    except Exception as exc:  # noqa: BLE001 — graceful-degrade boundary, reason is reported
        return {
            "name": "code_quality",
            "status": "SKIP",
            "reason": f"/code-quality invocation raised: {type(exc).__name__}: {exc}",
        }
    if summary is None:
        return {
            "name": "code_quality",
            "status": "SKIP",
            "reason": "/code-quality script unavailable or invocation failed",
        }

    verdict = summary.get("verdict", "UNKNOWN")
    score_cap = summary.get("score_cap", 100)
    hard_caps = summary.get("hard_caps_triggered", [])

    if verdict in ("FAIL_HARD", "INVALID"):
        status = "FAIL"
    elif verdict in ("FAIL_SOFT", "PASS_WITH_CAVEATS"):
        status = "WARN"
    elif verdict == "PASS":
        status = "PASS"
    else:
        status = "PARTIAL"

    return {
        "name": "code_quality",
        "status": status,
        "verdict": verdict,
        "score_cap": score_cap,
        "hard_caps_triggered": list(hard_caps),
        "languages_audited": summary.get("languages_audited", []),
    }


def _find_plan(project_root: Path, slug: str) -> Path | None:
    """Locate the plan file in either the plugin (.claude/) or standalone layout."""
    for base in (project_root / ".claude" / "knowledge-base" / "plans",
                 project_root / "knowledge-base" / "plans"):
        candidate = base / f"{slug}-plan.md"
        if candidate.exists():
            return candidate
    return None


_PATTERNS_SKILL_RE = re.compile(r"\b([A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*-patterns)\b")


def check_patterns_advisory(project_root: Path, slug: str) -> dict[str, Any]:
    """SOFT advisory (ADR D3) — never FAIL.

    Surfaces plan-cited `*-patterns` skills that do NOT appear in the
    implementation's changed files, so the implementer can confirm the pattern
    was actually applied. The BINDING guarantee lives at the plan layer
    (`check_patterns_consumption` hard cap); this gate is visibility only, so a
    miss returns WARN (which `main` never folds into a FAIL) — verifying "the
    code applied the pattern" semantically is not mechanizable.
    """
    name = "patterns_consumption"
    plan = _find_plan(project_root, slug)
    if plan is None:
        return {"name": name, "status": "N/A", "reason": "plan not found"}
    cited = sorted(set(_PATTERNS_SKILL_RE.findall(
        plan.read_text(encoding="utf-8-sig", errors="ignore"))))
    if not cited:
        return {"name": name, "status": "N/A", "reason": "plan cites no *-patterns skill"}
    progress = _read_progress(project_root, slug)
    files: list[str] = []
    if progress:
        for task in progress.get("tasks", []):
            files.extend(task.get("files", []) or [])
    if not files:
        return {"name": name, "status": "N/A", "cited": cited,
                "reason": "no implementation files recorded yet — cannot verify consumption"}
    blob = ""
    for rel in files:
        fpath = project_root / rel
        if fpath.is_file():
            blob += fpath.read_text(encoding="utf-8-sig", errors="ignore")
    not_found = [c for c in cited if c not in blob]
    if not_found:
        return {"name": name, "status": "WARN", "cited": cited, "not_found": not_found,
                "reason": (f"plan cites {not_found} but it does not appear in the changed "
                           "implementation files — confirm the pattern was applied (advisory, non-blocking)")}
    return {"name": name, "status": "PASS", "cited": cited}


def check_progress_schema_gate(project_root: Path, slug: str) -> dict[str, Any]:
    """Fail-fast validation of the checkpoint itself, BEFORE the gates that read it.

    A malformed `.progress-{slug}.json` (missing `tasks` envelope, `task_id` instead
    of `id`, missing `phase`) makes every phase-scoped gate degrade silently. This
    gate turns that into a loud, early failure (Unbreakable Rule 8)."""
    path = (project_root / ".claude" / "knowledge-base" / "implementations"
            / f".progress-{slug}.json")
    from check_progress_schema import check_progress_schema

    report = check_progress_schema(path)
    return {
        "name": "progress_schema",
        "status": report.status,
        "task_count": report.task_count,
        "findings": [{"severity": f.severity, "code": f.code, "message": f.message}
                     for f in report.findings],
    }


def check_checkpoint_consistency_gate(project_root: Path, slug: str) -> dict[str, Any]:
    """Cross-check the checkpoint against git in both directions: every committed
    task points at a real commit, and every plan task referenced by a real commit is
    recorded as committed. Catches a checkpoint that drifted out of sync with reality
    (e.g. a task finished + committed but the .progress update was skipped)."""
    path = (project_root / ".claude" / "knowledge-base" / "implementations"
            / f".progress-{slug}.json")
    plan = _find_plan(project_root, slug)
    if not path.exists():
        return {"name": "checkpoint_consistency", "status": "SKIP",
                "reason": "no progress checkpoint — implement may not have run"}
    if plan is None:
        return {"name": "checkpoint_consistency", "status": "SKIP",
                "reason": f"plan not found for slug '{slug}' — cannot map task ids"}

    import json as _json

    from check_checkpoint_consistency import (
        check_checkpoint_consistency,
        plan_task_ids_from_text,
    )

    try:
        progress = _json.loads(path.read_text(encoding="utf-8-sig"))
    except _json.JSONDecodeError:
        # The schema gate already reports malformed JSON loudly; don't double-fail.
        return {"name": "checkpoint_consistency", "status": "SKIP",
                "reason": "checkpoint is malformed JSON (see progress_schema gate)"}

    plan_ids = plan_task_ids_from_text(plan.read_text(encoding="utf-8-sig"))
    report = check_checkpoint_consistency(progress, project_root, plan_ids)
    return {
        "name": "checkpoint_consistency",
        "status": report.status,
        "committed_in_progress": report.committed_in_progress,
        "findings": [{"severity": f.severity, "code": f.code, "message": f.message}
                     for f in report.findings],
    }


def check_acceptance_criteria_gate(project_root: Path, slug: str) -> dict[str, Any]:
    """Enforce the plan's AC/DoD obligations that run_validation does not otherwise
    cover (file-size budget, CHANGELOG-updated) and surface the non-mechanizable
    ones, instead of trusting the LLM's self-ticked checkboxes (GAP 1+2)."""
    plan = _find_plan(project_root, slug)
    if plan is None:
        return {"name": "acceptance_criteria", "status": "SKIP",
                "reason": f"plan not found for slug '{slug}' — cannot audit criteria"}
    from check_acceptance_criteria import check_acceptance_criteria

    progress = _read_progress(project_root, slug)
    shas = shas_from_progress(progress) if isinstance(progress, dict) else []
    report = check_acceptance_criteria(plan, repo_root=project_root, shas=shas)
    return {
        "name": "acceptance_criteria",
        "status": report.status,
        "total_criteria": report.total_criteria,
        "by_category": report.by_category,
        "findings": [{"severity": f.severity, "code": f.code, "message": f.message}
                     for f in report.findings],
    }


def check_test_obligations_gate(project_root: Path, slug: str) -> dict[str, Any]:
    """Confirm declared concurrency/failure tests actually exist in the tree, instead
    of relying on a generic green test run that never exercised them (GAP 6)."""
    plan = _find_plan(project_root, slug)
    if plan is None:
        return {"name": "test_obligations", "status": "SKIP",
                "reason": f"plan not found for slug '{slug}' — cannot audit test obligations"}
    from check_test_obligations import check_test_obligations

    report = check_test_obligations(plan, repo_root=project_root)
    return {
        "name": "test_obligations",
        "status": report.status,
        "obligations": [{"kind": o.kind, "detail": o.detail} for o in report.obligations],
        "findings": [{"severity": f.severity, "code": f.code, "message": f.message}
                     for f in report.findings],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Final validation gate for /implement.")
    parser.add_argument("slug", help="Plan slug (matches .claude/knowledge-base/implementations/{slug}-implementation.md)")
    parser.add_argument("--project-root", type=Path, default=None)
    parser.add_argument("--no-write-report", action="store_true", help="don't save a markdown report")
    parser.add_argument(
        "--no-code-quality",
        action="store_true",
        help="skip the /code-quality gate (per ADR 0002; escape hatch for pre-code phase)",
    )
    args = parser.parse_args()

    project_root = args.project_root if args.project_root else _find_project_root(Path.cwd())

    checks = [
        check_progress_schema_gate(project_root, args.slug),
        check_checkpoint_consistency_gate(project_root, args.slug),
        check_npm_test(project_root),
        check_npm_typecheck(project_root),
        check_npm_lint(project_root),
        check_coverage(project_root),
        wiring_summary(project_root, args.slug),
        check_acceptance_criteria_gate(project_root, args.slug),
        check_test_obligations_gate(project_root, args.slug),
        check_patterns_advisory(project_root, args.slug),
        check_code_quality(project_root, args.slug, skip=args.no_code_quality),
    ]

    fails = [c for c in checks if c.get("status") == "FAIL"]
    skips = [c for c in checks if c.get("status") == "SKIP"]
    overall = "FAIL" if fails else ("PARTIAL" if skips else "PASS")

    report: dict[str, Any] = {
        "slug": args.slug,
        "project_root": str(project_root),
        "validated_at": datetime.now(timezone.utc).isoformat(),
        "overall_status": overall,
        "checks": checks,
        "summary": {
            # Every status bucket is counted so pass+fail+skip+warn+partial+n_a == total.
            "total": len(checks),
            "pass": sum(1 for c in checks if c.get("status") == "PASS"),
            "fail": len(fails),
            "skip": len(skips),
            "warn": sum(1 for c in checks if c.get("status") == "WARN"),
            "partial": sum(1 for c in checks if c.get("status") == "PARTIAL"),
            "n_a": sum(1 for c in checks if c.get("status") == "N/A"),
        },
    }

    print(json.dumps(report, indent=2))

    if not args.no_write_report:
        review_dir = project_root / ".claude" / "knowledge-base" / "reviews"
        review_dir.mkdir(parents=True, exist_ok=True)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        md_path = review_dir / f"{args.slug}-implement-validate-{today}.md"
        md = f"""# Implementation Validation: {args.slug}

**Date:** {today}
**Overall:** {overall}
**Total checks:** {len(checks)} (PASS: {report['summary']['pass']}, FAIL: {len(fails)}, SKIP: {len(skips)})

## Checks

"""
        for c in checks:
            md += f"### {c.get('name', 'unknown')} — `{c.get('status')}`\n\n"
            if "reason" in c:
                md += f"- Reason: {c['reason']}\n"
            if c.get("name") == "wiring_triad" and c.get("status") != "SKIP":
                md += f"- Total tasks: {c.get('total_tasks')}\n"
                md += "- Verification: independent recheck of `check_wiring.py`\n"
                md += f"- Symbols derived from diff: {c.get('symbols_derived')}\n"
                md += f"- Symbols independently resolved: {c.get('symbols_resolved')}\n"
                md += f"- Pillar (a) fails (uncalled symbols): {c.get('pillar_a_fails')}\n"
                if c.get("pillar_a_fail_symbols"):
                    md += f"- Failing symbols: {', '.join(c['pillar_a_fail_symbols'])}\n"
                md += f"- Self-reported pillar (a) pass (claim, audited): {c.get('self_reported_pillar_a_pass')}\n"
                if c.get("fabricated_wiring_evidence"):
                    md += "- ⚠️ **Fabricated wiring evidence detected** — self-report contradicts recheck\n"
            for finding in c.get("findings", []):
                md += f"- [{finding['severity']}] {finding['code']}: {finding['message']}\n"
            if c.get("status") == "FAIL" and "stderr_tail" in c:
                md += f"\n```\n{c['stderr_tail'][:500]}\n```\n"
            md += "\n"
        md += """## Handoff decision

"""
        if overall == "PASS":
            md += "Implementation PASSes all gates. Ready for `cycle-review` (when built).\n"
        elif overall == "FAIL":
            md += "Implementation FAILS at least one gate. Loop back to /implement to address.\n"
        else:
            md += "Implementation PARTIAL — some gates were SKIPped because pre-conditions absent (e.g., package.json). Decide whether SKIPs are acceptable for this phase.\n"
        md_path.write_text(md, encoding="utf-8")
        print(f"\nReport saved: {md_path}", file=sys.stderr)

    return 0 if overall in ("PASS", "PARTIAL") else 1


if __name__ == "__main__":
    sys.exit(main())
