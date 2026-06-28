#!/usr/bin/env python3
"""Fail-fast validator for the /implement progress checkpoint.

The checkpoint (`.progress-{slug}.json`) is the contract between the halt-loop (which
WRITES it each iteration) and six gate scripts (which READ it). A review found the
example in `implementation-prompt.md` diverged from what the gates consume in three
ways — a bare task object instead of a `{"tasks": [...]}` envelope, `task_id` instead
of `id`, and missing `phase`/`files`. Each divergence made gates degrade SILENTLY:
phase-scoped filters matched nothing, so `check_phase_completeness` reported
`phase_not_found`, `check_diff_cohesion` saw no files, and symbol derivation came up
empty — all without a clear "your checkpoint is malformed" signal.

This validator turns that silent degradation into a loud, early failure (Unbreakable
Rule 8 — fail fast, fail clear). The canonical shape lives in
`templates/progress-schema.json`; this script enforces the structural subset the gates
actually depend on, without adding a `jsonschema` dependency (the checks are simple
and explicit on purpose).

Exit codes (CLI): 0 — PASS/WARN/SKIP; 1 — FAIL (malformed checkpoint); 2 — bad args.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

_VALID_STATUSES = {"pending", "red", "green", "refactor", "wired", "committed", "blocked", "done"}
_VALID_WIRING = {
    "a": {"pass", "fail", "defer", None},
    "b": {"pass", "fail", "defer", "n/a", None},
    "c": {"pass", "fail", "n/a", None},
}


@dataclass(frozen=True)
class Finding:
    severity: str  # BLOCKER | HIGH | MEDIUM | LOW | INFO
    code: str
    message: str


@dataclass(frozen=True)
class ProgressSchemaReport:
    exists: bool
    task_count: int
    findings: tuple[Finding, ...] = field(default_factory=tuple)

    @property
    def has_high_or_blocker(self) -> bool:
        return any(f.severity in ("HIGH", "BLOCKER") for f in self.findings)

    @property
    def status(self) -> str:
        if not self.exists:
            return "SKIP"
        if self.has_high_or_blocker:
            return "FAIL"
        if self.findings:
            return "WARN"
        return "PASS"


def validate_progress(data: object) -> list[Finding]:
    """Validate a parsed checkpoint against the gate-consumed structural contract."""
    findings: list[Finding] = []

    if not isinstance(data, dict):
        return [Finding("BLOCKER", "progress_not_object",
                        "Top-level checkpoint must be a JSON object with a 'tasks' array; "
                        f"got {type(data).__name__}.")]

    if "tasks" not in data:
        findings.append(Finding(
            "BLOCKER", "progress_missing_tasks",
            "No 'tasks' key. Every gate reads data['tasks']; a bare task object (e.g. "
            "`{\"task_id\": ...}`) is not consumable. Wrap tasks in "
            "`{\"slug\": ..., \"tasks\": [ ... ]}`."))
        return findings

    tasks = data["tasks"]
    if not isinstance(tasks, list):
        findings.append(Finding(
            "BLOCKER", "tasks_not_array",
            f"'tasks' must be an array, got {type(tasks).__name__}. Gates iterate it."))
        return findings

    seen_ids: set[str] = set()
    for i, task in enumerate(tasks):
        findings.extend(_validate_task(i, task, seen_ids))
    return findings


def _validate_task(index: int, task: object, seen_ids: set[str]) -> list[Finding]:
    findings: list[Finding] = []
    where = f"tasks[{index}]"
    if not isinstance(task, dict):
        return [Finding("BLOCKER", "task_not_object",
                        f"{where} must be an object, got {type(task).__name__}.")]

    # id (read as 'id', NOT 'task_id')
    if "id" not in task and "task_id" in task:
        findings.append(Finding(
            "HIGH", "task_uses_task_id_key",
            f"{where} uses 'task_id'; gates read 'id' (check_phase_completeness). "
            "Rename the key to 'id'."))
    elif not task.get("id"):
        findings.append(Finding("HIGH", "task_missing_id",
                                f"{where} has no 'id' (e.g. 'T1.1')."))
    else:
        tid = task["id"]
        if tid in seen_ids:
            findings.append(Finding("MEDIUM", "task_duplicate_id",
                                    f"{where} repeats id '{tid}'."))
        seen_ids.add(tid)

    # phase (gates filter by str(task['phase']))
    if task.get("phase") is None:
        findings.append(Finding(
            "HIGH", "task_missing_phase",
            f"{where} has no 'phase'. Phase-scoped gates filter by str(task['phase']); "
            "without it the task is invisible to mini_review / diff_cohesion / "
            "phase_completeness."))

    # status
    status = task.get("status")
    if status is None:
        findings.append(Finding("HIGH", "task_missing_status", f"{where} has no 'status'."))
    elif status not in _VALID_STATUSES:
        findings.append(Finding(
            "MEDIUM", "task_invalid_status",
            f"{where} status '{status}' is not one of {sorted(_VALID_STATUSES)}."))

    # committed → needs a SHA (diff_cohesion / diff_symbols rely on it)
    if status == "committed" and not task.get("commit_sha"):
        findings.append(Finding(
            "MEDIUM", "committed_without_sha",
            f"{where} is 'committed' but has no 'commit_sha'; diff-based gates cannot "
            "derive its real diff."))

    # blocked → needs an explicit reason (honesty contract)
    if status == "blocked" and not task.get("blocked_reason"):
        findings.append(Finding(
            "MEDIUM", "blocked_without_reason",
            f"{where} is 'blocked' but records no 'blocked_reason'. A blocked task MUST "
            "state the blocker + recommended human action."))

    # wiring shape
    wiring = task.get("wiring")
    if wiring is not None:
        if not isinstance(wiring, dict):
            findings.append(Finding("MEDIUM", "wiring_not_object",
                                    f"{where} 'wiring' must be an object with a/b/c keys."))
        else:
            for pillar, allowed in _VALID_WIRING.items():
                if pillar in wiring and wiring[pillar] not in allowed:
                    findings.append(Finding(
                        "LOW", "wiring_invalid_value",
                        f"{where} wiring.{pillar} = {wiring[pillar]!r}; "
                        f"expected one of {sorted(v for v in allowed if v)}."))
    return findings


def check_progress_schema(progress_path: Path) -> ProgressSchemaReport:
    if not progress_path.exists():
        return ProgressSchemaReport(exists=False, task_count=0)
    try:
        data = json.loads(progress_path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        return ProgressSchemaReport(
            exists=True, task_count=0,
            findings=(Finding("BLOCKER", "progress_malformed_json",
                              f"Checkpoint is not valid JSON: {exc}"),))

    findings = validate_progress(data)
    task_count = len(data["tasks"]) if isinstance(data, dict) and isinstance(data.get("tasks"), list) else 0
    return ProgressSchemaReport(exists=True, task_count=task_count, findings=tuple(findings))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--progress", type=Path, required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    report = check_progress_schema(args.progress)

    if args.json:
        print(json.dumps({
            "exists": report.exists,
            "task_count": report.task_count,
            "status": report.status,
            "findings": [{"severity": f.severity, "code": f.code, "message": f.message}
                         for f in report.findings],
            "has_high_or_blocker": report.has_high_or_blocker,
        }, indent=2))
    else:
        print(f"Progress checkpoint: {report.status} ({report.task_count} task(s))")
        for f in report.findings:
            print(f"  [{f.severity}] {f.code}: {f.message}")

    return 1 if report.has_high_or_blocker else 0


if __name__ == "__main__":
    sys.exit(main())
