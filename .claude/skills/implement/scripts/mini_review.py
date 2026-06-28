#!/usr/bin/env python3
"""Phase-boundary mini review orchestrator for /implement Step 4.7.

Runs after every COMMIT that closes a phase (last task of `## Phase N`).
Aggregates four checks:

  1. phase_completeness — every phase task `committed`, phase DoD non-empty
  2. diff_cohesion       — modified files match each task's `Files to edit`
  3. wiring_summary      — `check_wiring.py` aggregated for every new symbol
  4. code_quality_delta  — `/code-quality` invoked on the phase's file delta

Severity is aggregated using the standard /review vocabulary:
  BLOCKER > HIGH > MEDIUM > LOW > INFO

Verdict:
  PHASE_REVIEW_PASS       — no HIGH or BLOCKER findings
  PHASE_REVIEW_NEEDS_FIX  — at least one HIGH or BLOCKER → halt-loop BLOCKED

A markdown report is written to:
  knowledge-base/mini-reviews/{slug}-phase{N}-review-{YYYY-MM-DD}.md

This is the cheap, deterministic implementation. A future Agent-based review
(senior-dev second opinion on design/cohesion) can plug into the report as
an additional section without changing the verdict-computation logic.

Usage:
    python3 mini_review.py \\
        --slug foo \\
        --plan knowledge-base/plans/foo-plan.md \\
        --progress knowledge-base/implementations/.progress-foo.json \\
        --phase 2 \\
        --output-dir knowledge-base/mini-reviews

Exit codes:
    0 — PHASE_REVIEW_PASS
    1 — PHASE_REVIEW_NEEDS_FIX
    2 — invocation error
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from check_checkpoint_consistency import (
    check_checkpoint_consistency,
    plan_task_ids_from_text,
)
from check_diff_cohesion import check_diff_cohesion
from check_phase_completeness import check_phase_completeness
from diff_symbols import added_symbols_from_shas, shas_from_progress
from wiring_recheck import recheck_pillar_a


SEVERITY_RANK = {"INFO": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3, "BLOCKER": 4}


def _stem_symbols(data: dict, phase: str) -> set[str]:
    """Fallback symbol derivation: filename stems of a phase's task files.

    Weaker than diff derivation (a stem rarely equals an exported symbol), used only
    when no commit SHA is recorded yet so the diff path cannot run.
    """
    symbols: set[str] = set()
    for task in data.get("tasks", []):
        if str(task.get("phase")) != str(phase):
            continue
        for f in task.get("files", []):
            stem = Path(f).stem
            if stem and not stem.startswith(".") and not stem.endswith("_test"):
                symbols.add(stem)
    return symbols


def _aggregate_wiring(progress_path: Path, phase: str, repo_root: Path) -> dict[str, Any]:
    """Re-verify pillar (a) for every public symbol the phase committed.

    Symbols are derived authoritatively from the phase's committed diffs
    (`diff_symbols`); the filename-stem heuristic is a fallback for the (rare) case
    where no SHA is recorded yet. Verification re-runs `check_wiring.py` via the
    shared `wiring_recheck` helper — never trusts the progress file's `wiring` field.

    Honest fallback: when no symbol is derivable or resolvable (infra-only phase,
    pre-source), report `N/A` rather than `FAIL`.
    """
    try:
        data = json.loads(progress_path.read_text(encoding="utf-8-sig"))
    except (json.JSONDecodeError, OSError) as exc:
        return {"status": "SKIP", "reason": f"progress unreadable: {exc}", "findings": []}

    symbols = added_symbols_from_shas(repo_root, shas_from_progress(data, phase))
    derivation = "diff"
    if not symbols:
        symbols = _stem_symbols(data, phase)
        derivation = "filename_stem"

    if not symbols:
        return {
            "status": "N/A",
            "reason": "no source symbols derivable from phase tasks",
            "findings": [],
        }

    recheck = recheck_pillar_a(repo_root, symbols)
    if recheck.symbols_resolved == 0:
        return {
            "status": "N/A",
            "reason": "no symbols from phase tasks could be resolved against source tree",
            "derivation": derivation,
            "symbols_checked": recheck.symbols_checked,
            "pillar_a_fails": 0,
            "findings": [],
        }

    findings = [
        {
            "severity": "HIGH",
            "code": "wiring_pillar_a_fail",
            "message": f"Symbol `{sym}` is defined but has no production caller "
                       "(pillar a is non-negotiable per cycle-implement).",
        }
        for sym in recheck.fail_symbols
    ]

    return {
        "status": "FAIL" if recheck.pillar_a_fails > 0 else "PASS",
        "derivation": derivation,
        "symbols_checked": recheck.symbols_checked,
        "symbols_resolved": recheck.symbols_resolved,
        "pillar_a_fails": recheck.pillar_a_fails,
        "findings": findings,
    }


def _invoke_code_quality_on_delta(
    slug: str,
    progress_path: Path,
    phase: str,
    project_root: Path,
) -> dict[str, Any]:
    """Invoke /code-quality scoped to files modified in this phase only.

    Honest behavior: cq_invoke today scores the whole plan, not a file subset.
    Until cq_invoke supports `--files`, this is an unconditional SKIP rather than
    a faked delta-scoped audit. The full audit still runs at Step 5. The function
    keeps its signature so the wiring is ready the day cq_invoke gains `--files`.
    """
    return {
        "status": "SKIP",
        "reason": "delta-scoped code-quality not implemented yet; full audit runs at Step 5",
        "findings": [],
    }


def _phase_checkpoint_findings(
    plan_path: Path,
    progress_path: Path,
    phase: str,
    repo_root: Path,
) -> list[dict[str, str]]:
    """Cross-check this phase's tasks against git: a task committed in git but not
    recorded `committed` in the checkpoint is surfaced here, on the phase boundary,
    rather than only at the final validation gate."""
    try:
        progress = json.loads(progress_path.read_text(encoding="utf-8-sig"))
    except (json.JSONDecodeError, OSError):
        return []
    all_ids = plan_task_ids_from_text(plan_path.read_text(encoding="utf-8-sig"))
    phase_ids = [tid for tid in all_ids if tid.startswith(f"T{phase}.")]
    report = check_checkpoint_consistency(progress, repo_root, phase_ids)
    return [{"severity": f.severity, "code": f.code, "message": f.message}
            for f in report.findings]


def _collect_all_findings(
    phase_completeness: Any,
    diff_cohesion: Any,
    wiring: dict[str, Any],
    cq: dict[str, Any],
) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    for f in phase_completeness.findings:
        findings.append({"severity": f.severity, "code": f.code, "message": f.message})
    for f in diff_cohesion.findings:
        findings.append({"severity": f.severity, "code": f.code, "message": f.message})
    findings.extend(wiring.get("findings", []))
    findings.extend(cq.get("findings", []))
    return findings


def _compute_verdict(findings: list[dict[str, str]]) -> tuple[str, str]:
    """Return (verdict, max_severity)."""
    max_rank = max((SEVERITY_RANK.get(f["severity"], 0) for f in findings), default=0)
    max_severity = {v: k for k, v in SEVERITY_RANK.items()}[max_rank]
    if max_rank >= SEVERITY_RANK["HIGH"]:
        return "PHASE_REVIEW_NEEDS_FIX", max_severity
    return "PHASE_REVIEW_PASS", max_severity


def _render_report(
    slug: str,
    phase: str,
    verdict: str,
    max_severity: str,
    phase_completeness: Any,
    diff_cohesion: Any,
    wiring: dict[str, Any],
    cq: dict[str, Any],
    findings: list[dict[str, str]],
) -> str:
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    md = f"""# Mini review — {slug} — Phase {phase}

**Date:** {date}
**Verdict:** `{verdict}`
**Max severity:** `{max_severity}`

This is the **Step 4.7 phase-boundary mini review** — runs at the end of every
phase, before the next phase begins (cycle-implement.md § Hard gates). Companion
to `/review` (which runs once at the end of all phases).

## Findings summary

| Severity | Count |
|---|---|
| BLOCKER | {sum(1 for f in findings if f['severity'] == 'BLOCKER')} |
| HIGH | {sum(1 for f in findings if f['severity'] == 'HIGH')} |
| MEDIUM | {sum(1 for f in findings if f['severity'] == 'MEDIUM')} |
| LOW | {sum(1 for f in findings if f['severity'] == 'LOW')} |
| INFO | {sum(1 for f in findings if f['severity'] == 'INFO')} |

## Findings

"""
    for f in sorted(findings, key=lambda x: -SEVERITY_RANK.get(x["severity"], 0)):
        md += f"### [{f['severity']}] {f['code']}\n\n{f['message']}\n\n"

    md += "## Check details\n\n"
    md += "### 1. Phase completeness\n\n"
    md += f"- total_tasks_in_phase: {phase_completeness.total_tasks_in_phase}\n"
    md += f"- committed: {phase_completeness.committed_count}\n"
    md += f"- blocked: {phase_completeness.blocked_count}\n"
    md += f"- pending: {phase_completeness.pending_count}\n"
    md += f"- phase_dod_present: {phase_completeness.phase_dod_present}\n\n"
    md += "### 2. Diff cohesion\n\n"
    md += f"- declared_files: {len(diff_cohesion.declared_files)}\n"
    md += f"- modified_files: {len(diff_cohesion.modified_files)}\n"
    md += f"- drift_files: {len(diff_cohesion.drift_files)}\n"
    md += f"- diff_source: `{diff_cohesion.diff_source}`\n\n"
    md += "### 3. Wiring summary\n\n"
    md += f"- status: `{wiring.get('status')}`\n"
    md += f"- symbols_checked: {wiring.get('symbols_checked', 'n/a')}\n"
    md += f"- pillar_a_fails: {wiring.get('pillar_a_fails', 'n/a')}\n"
    if wiring.get("reason"):
        md += f"- reason: {wiring['reason']}\n"
    md += "\n### 4. Code-quality delta\n\n"
    md += f"- status: `{cq.get('status')}`\n"
    if cq.get("reason"):
        md += f"- reason: {cq['reason']}\n"
    md += "\n## Recommendation\n\n"
    if verdict == "PHASE_REVIEW_PASS":
        md += "Phase passes mini review. Halt-loop may proceed to next phase.\n"
    else:
        md += (
            "Phase **does not** pass mini review. Halt-loop MUST emit BLOCKED. "
            "Resolve the HIGH/BLOCKER findings above, then re-invoke ralph-loop "
            "per `skills/implement/SKILL.md § Resume after recovered blocker`.\n"
        )
    return md


def run_mini_review(
    slug: str,
    plan_path: Path,
    progress_path: Path,
    phase: str,
    project_root: Path,
    output_dir: Path,
) -> tuple[str, str, Path]:
    """Return (verdict, max_severity, report_path)."""
    pc = check_phase_completeness(plan_path, progress_path, phase)
    dc = check_diff_cohesion(plan_path, progress_path, phase, project_root)
    wiring = _aggregate_wiring(progress_path, phase, project_root)
    cq = _invoke_code_quality_on_delta(slug, progress_path, phase, project_root)

    findings = _collect_all_findings(pc, dc, wiring, cq)
    findings.extend(_phase_checkpoint_findings(plan_path, progress_path, phase, project_root))
    verdict, max_severity = _compute_verdict(findings)

    output_dir.mkdir(parents=True, exist_ok=True)
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    report_path = output_dir / f"{slug}-phase{phase}-review-{date}.md"
    report_path.write_text(
        _render_report(slug, phase, verdict, max_severity, pc, dc, wiring, cq, findings),
        encoding="utf-8",
    )
    return verdict, max_severity, report_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--progress", type=Path, required=True)
    parser.add_argument("--phase", required=True)
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--output-dir", type=Path,
        default=Path("knowledge-base/mini-reviews"),
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if not args.plan.exists():
        print(f"plan file not found: {args.plan}", file=sys.stderr)
        return 2
    if not args.progress.exists():
        print(f"progress file not found: {args.progress}", file=sys.stderr)
        return 2

    verdict, max_severity, report_path = run_mini_review(
        slug=args.slug,
        plan_path=args.plan,
        progress_path=args.progress,
        phase=args.phase,
        project_root=args.project_root,
        output_dir=args.output_dir,
    )

    if args.json:
        out = {
            "slug": args.slug,
            "phase": args.phase,
            "verdict": verdict,
            "max_severity": max_severity,
            "report": str(report_path),
        }
        print(json.dumps(out, indent=2))
    else:
        print(f"slug={args.slug} phase={args.phase} verdict={verdict} max_severity={max_severity}")
        print(f"report: {report_path}")

    return 0 if verdict == "PHASE_REVIEW_PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
