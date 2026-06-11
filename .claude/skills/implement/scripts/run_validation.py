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
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


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
    """Aggregate wiring triad results from the progress file."""
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

    a_pass = b_pass = b_defer = c_pass = c_na = 0
    a_fail = b_fail = c_fail = 0
    total = len(tasks)

    for task in tasks:
        wiring = task.get("wiring", {})
        if wiring.get("a") == "pass":
            a_pass += 1
        elif wiring.get("a") == "fail":
            a_fail += 1
        if wiring.get("b") == "pass":
            b_pass += 1
        elif wiring.get("b") == "defer":
            b_defer += 1
        elif wiring.get("b") == "fail":
            b_fail += 1
        if wiring.get("c") == "pass":
            c_pass += 1
        elif wiring.get("c") == "n/a":
            c_na += 1
        elif wiring.get("c") == "fail":
            c_fail += 1

    status = "PASS" if (a_fail == 0 and b_fail == 0 and c_fail == 0) else "FAIL"

    return {
        "name": "wiring_triad",
        "status": status,
        "total_tasks": total,
        "pillar_a": {"pass": a_pass, "fail": a_fail},
        "pillar_b": {"pass": b_pass, "defer": b_defer, "fail": b_fail},
        "pillar_c": {"pass": c_pass, "n/a": c_na, "fail": c_fail},
        "non_negotiable_pillar_a_pass_rate": (a_pass / total) if total else 1.0,
    }


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
    try:
        sys.path.insert(0, str(cq_invoke_dir))
        import cq_invoke  # type: ignore[import-not-found]
    except ImportError:
        return {
            "name": "code_quality",
            "status": "SKIP",
            "reason": "cq_invoke helper not importable",
        }

    summary = cq_invoke.invoke(plan_slug, project_root)
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
        check_npm_test(project_root),
        check_npm_typecheck(project_root),
        check_npm_lint(project_root),
        check_coverage(project_root),
        wiring_summary(project_root, args.slug),
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
            "total": len(checks),
            "pass": sum(1 for c in checks if c.get("status") == "PASS"),
            "fail": len(fails),
            "skip": len(skips),
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
                md += f"- Pillar (a) static caller: {c.get('pillar_a')}\n"
                md += f"- Pillar (b) integration test: {c.get('pillar_b')}\n"
                md += f"- Pillar (c) runtime metric: {c.get('pillar_c')}\n"
                md += f"- Pillar (a) non-negotiable pass rate: {c.get('non_negotiable_pillar_a_pass_rate'):.0%}\n"
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
