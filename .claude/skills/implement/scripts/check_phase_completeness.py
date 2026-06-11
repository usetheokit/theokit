#!/usr/bin/env python3
"""Phase completeness check for /implement Step 4.7 mini review.

Reads .progress-{slug}.json and the plan, verifies every task in a given
phase has status `committed`. If the plan declares a Phase-level DoD
section (`### Phase N — Definition of Done`), each bullet is treated as
a TODO that needs an audit signal (today: just verify the section exists
and is non-empty; richer parsing is intentional follow-up).

Companion to:
  - check_diff_cohesion.py (scope/layer drift)
  - mini_review.py (orchestrator)

Severity:
  HIGH if any task in the phase has status ∈ {blocked, pending} when the phase
       boundary is being checked (we expect them all committed).
  MEDIUM if Phase-level DoD section is declared but appears empty.
  INFO if everything OK.

Usage:
    python3 check_phase_completeness.py \\
        --plan knowledge-base/plans/foo-plan.md \\
        --progress knowledge-base/implementations/.progress-foo.json \\
        --phase 1 \\
        --json

Exit codes:
    0 — all PASS or INFO only
    1 — at least one HIGH or BLOCKER finding
    2 — invocation error (file missing, parse error, phase out of range)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

PHASE_HEADER_RE = re.compile(r"^##\s+Phase\s+(\d+)(?:\s*[:\-—]\s*(.+?))?\s*$", re.MULTILINE)
PHASE_DOD_RE = re.compile(
    r"^###\s+Phase\s+(\d+)\s*(?:[:\-—]\s*)?Definition\s+of\s+Done\s*$"
    r"(.+?)(?=^##\s|^###\s|\Z)",
    re.MULTILINE | re.DOTALL | re.IGNORECASE,
)


@dataclass(frozen=True)
class Finding:
    severity: str  # BLOCKER | HIGH | MEDIUM | LOW | INFO
    code: str
    message: str


@dataclass(frozen=True)
class PhaseCompletenessReport:
    phase: str
    total_tasks_in_phase: int
    committed_count: int
    blocked_count: int
    pending_count: int
    phase_dod_present: bool
    phase_dod_lines: int
    findings: tuple[Finding, ...] = field(default_factory=tuple)

    @property
    def has_high_or_blocker(self) -> bool:
        return any(f.severity in ("HIGH", "BLOCKER") for f in self.findings)


def _load_progress(progress_path: Path) -> dict:
    return json.loads(progress_path.read_text(encoding="utf-8-sig"))


def _tasks_in_phase(progress: dict, phase: str) -> list[dict]:
    return [t for t in progress.get("tasks", []) if str(t.get("phase")) == str(phase)]


def _plan_declares_phase_dod(plan_path: Path, phase: str) -> tuple[bool, int]:
    """Return (declared?, non_empty_line_count) for the phase DoD section."""
    content = plan_path.read_text(encoding="utf-8-sig")
    for match in PHASE_DOD_RE.finditer(content):
        if match.group(1) == str(phase):
            body = match.group(2)
            non_empty = [line for line in body.splitlines() if line.strip()]
            return True, len(non_empty)
    return False, 0


def check_phase_completeness(
    plan_path: Path,
    progress_path: Path,
    phase: str,
) -> PhaseCompletenessReport:
    progress = _load_progress(progress_path)
    tasks = _tasks_in_phase(progress, phase)

    findings: list[Finding] = []

    if not tasks:
        findings.append(Finding(
            severity="HIGH",
            code="phase_not_found_in_progress",
            message=f"Phase {phase} has zero tasks in {progress_path.name}; nothing to review.",
        ))
        return PhaseCompletenessReport(
            phase=str(phase),
            total_tasks_in_phase=0,
            committed_count=0, blocked_count=0, pending_count=0,
            phase_dod_present=False, phase_dod_lines=0,
            findings=tuple(findings),
        )

    committed = [t for t in tasks if t.get("status") == "committed"]
    blocked = [t for t in tasks if t.get("status") == "blocked"]
    pending = [t for t in tasks if t.get("status") not in ("committed", "blocked")]

    if blocked:
        ids = ", ".join(sorted(t.get("id", "?") for t in blocked))
        findings.append(Finding(
            severity="HIGH",
            code="phase_has_blocked_tasks",
            message=f"Phase {phase} has {len(blocked)} BLOCKED task(s): {ids}",
        ))

    if pending:
        ids = ", ".join(sorted(t.get("id", "?") for t in pending))
        findings.append(Finding(
            severity="HIGH",
            code="phase_has_pending_tasks",
            message=(
                f"Phase {phase} boundary reached but {len(pending)} task(s) still pending: {ids}. "
                "Phase boundary should only trigger after all tasks of the phase are committed."
            ),
        ))

    phase_dod_present, phase_dod_lines = _plan_declares_phase_dod(plan_path, phase)
    if phase_dod_present and phase_dod_lines == 0:
        findings.append(Finding(
            severity="MEDIUM",
            code="phase_dod_empty",
            message=f"Plan declares `### Phase {phase} — Definition of Done` but the section is empty.",
        ))
    elif not phase_dod_present:
        # Not all plans declare phase-level DoD; this is informational only.
        findings.append(Finding(
            severity="INFO",
            code="phase_dod_absent",
            message=f"Plan does not declare a `### Phase {phase} — Definition of Done` section (optional).",
        ))

    return PhaseCompletenessReport(
        phase=str(phase),
        total_tasks_in_phase=len(tasks),
        committed_count=len(committed),
        blocked_count=len(blocked),
        pending_count=len(pending),
        phase_dod_present=phase_dod_present,
        phase_dod_lines=phase_dod_lines,
        findings=tuple(findings),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--progress", type=Path, required=True)
    parser.add_argument("--phase", required=True, help="Phase identifier (e.g. 1, 2, ...)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if not args.plan.exists():
        print(f"plan file not found: {args.plan}", file=sys.stderr)
        return 2
    if not args.progress.exists():
        print(f"progress file not found: {args.progress}", file=sys.stderr)
        return 2

    try:
        report = check_phase_completeness(args.plan, args.progress, args.phase)
    except (json.JSONDecodeError, OSError) as exc:
        print(f"parse error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        out = {
            "phase": report.phase,
            "total_tasks_in_phase": report.total_tasks_in_phase,
            "committed_count": report.committed_count,
            "blocked_count": report.blocked_count,
            "pending_count": report.pending_count,
            "phase_dod_present": report.phase_dod_present,
            "phase_dod_lines": report.phase_dod_lines,
            "findings": [{"severity": f.severity, "code": f.code, "message": f.message} for f in report.findings],
            "has_high_or_blocker": report.has_high_or_blocker,
        }
        print(json.dumps(out, indent=2))
    else:
        print(f"Phase {report.phase}: {report.committed_count}/{report.total_tasks_in_phase} committed")
        for f in report.findings:
            print(f"  [{f.severity}] {f.code}: {f.message}")

    return 1 if report.has_high_or_blocker else 0


if __name__ == "__main__":
    sys.exit(main())
