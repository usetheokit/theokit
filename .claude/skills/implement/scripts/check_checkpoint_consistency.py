#!/usr/bin/env python3
"""Checkpoint-vs-git consistency gate for /implement.

The progress checkpoint (`.progress-{slug}.json`) is maintained by the halt-loop as a
DISCIPLINE — the prompt tells the LLM to record each task as it lands, but nothing
forces it. `check_progress_schema.py` validates the SHAPE of what is written; this gate
validates that what is written matches REALITY (the git history), in both directions:

  - Forward  (progress → git): every task marked `committed` carries a `commit_sha`
    that actually EXISTS in the repository. Catches a fabricated or stale SHA.
  - Backward (git → progress): every plan task whose id appears in a REAL commit
    body (the halt-loop's commit convention is `T{N.M}: <ref>` in the message) has a
    matching `committed` entry in the checkpoint. Catches the exact failure mode of
    "task finished and committed, but the checkpoint update was skipped".

The backward check is the deterministic answer to "does the system force the JSON to
be updated per task?" — no PostToolUse hook forces it at write time, but this gate
fails loudly if a committed task is missing from the checkpoint, so the omission
cannot survive to handoff.

Honest limits:
  - The backward check relies on the commit-message convention (`T{N.M}` in the body).
    A task committed WITHOUT its id in the message is invisible to it — so this
    complements, not replaces, the phase-completeness gate.
  - The git scan is bounded to the most recent commits (default 500) to stay cheap on
    large repos; a task buried deeper than that is not cross-checked.

Exit codes (CLI): 0 — PASS/SKIP; 1 — FAIL (inconsistency); 2 — invocation error.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

_TASK_HEADER_RE = re.compile(r"^###\s+(T\d+\.\d+)\b", re.MULTILINE)
_GIT_SCAN_LIMIT = 500


@dataclass(frozen=True)
class Finding:
    severity: str
    code: str
    message: str


@dataclass(frozen=True)
class CheckpointConsistencyReport:
    committed_in_progress: int
    findings: tuple[Finding, ...] = field(default_factory=tuple)

    @property
    def has_high_or_blocker(self) -> bool:
        return any(f.severity in ("HIGH", "BLOCKER") for f in self.findings)

    @property
    def status(self) -> str:
        if self.has_high_or_blocker:
            return "FAIL"
        if self.findings:
            return "WARN"
        return "PASS"


def plan_task_ids_from_text(plan_text: str) -> list[str]:
    """Ordered, de-duplicated task ids (`T{N}.{M}`) from a plan's `### T..` headers."""
    ids: list[str] = []
    for m in _TASK_HEADER_RE.finditer(plan_text):
        tid = m.group(1)
        if tid not in ids:
            ids.append(tid)
    return ids


def _commit_exists(repo_root: Path, sha: str) -> bool:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_root), "cat-file", "-e", f"{sha}^{{commit}}"],
            capture_output=True, text=True, timeout=10,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return False
    return result.returncode == 0


def _task_ids_in_git_history(repo_root: Path, candidate_ids: list[str]) -> set[str]:
    """Of `candidate_ids`, which appear (as whole tokens) in a recent commit body.

    One git pass, parsed locally — cheaper and more precise than one `git log --grep`
    per id. Records are NUL-separated (`-z`); each is `<sha>\\x1f<full message>`.
    """
    if not candidate_ids:
        return set()
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_root), "log", "-n", str(_GIT_SCAN_LIMIT),
             "-z", "--format=%H%x1f%B"],
            capture_output=True, text=True, timeout=20,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return set()
    if result.returncode != 0:
        return set()

    patterns = {tid: re.compile(rf"\b{re.escape(tid)}\b") for tid in candidate_ids}
    found: set[str] = set()
    for record in result.stdout.split("\x00"):
        if not record.strip():
            continue
        _sha, _sep, body = record.partition("\x1f")
        for tid, pat in patterns.items():
            if tid not in found and pat.search(body):
                found.add(tid)
    return found


def check_checkpoint_consistency(
    progress: dict,
    repo_root: Path,
    plan_task_ids: list[str],
) -> CheckpointConsistencyReport:
    tasks = progress.get("tasks", []) if isinstance(progress, dict) else []
    tasks = [t for t in tasks if isinstance(t, dict)]
    by_id = {t["id"]: t for t in tasks if t.get("id")}
    committed_ids = {tid for tid, t in by_id.items() if t.get("status") == "committed"}

    findings: list[Finding] = []

    # Forward: every committed task points at a SHA that exists in git.
    for tid in sorted(committed_ids):
        sha = by_id[tid].get("commit_sha")
        if not sha:
            continue  # schema gate already flags committed-without-sha
        if not _commit_exists(repo_root, sha):
            findings.append(Finding(
                "HIGH", "committed_sha_not_in_git",
                f"Task {tid} is 'committed' with commit_sha '{sha}', but no such commit "
                "exists in the repository. The checkpoint points at a fabricated or "
                "stale SHA."))

    # Backward: every plan task referenced by a real commit must be committed here.
    referenced = _task_ids_in_git_history(repo_root, plan_task_ids)
    for tid in plan_task_ids:
        if tid not in referenced:
            continue
        task = by_id.get(tid)
        if task is None:
            findings.append(Finding(
                "HIGH", "task_committed_in_git_not_in_progress",
                f"Task {tid} is referenced by a real commit in git but has NO entry in "
                "the checkpoint. A finished task was committed without updating "
                ".progress — the checkpoint is out of sync with reality."))
        elif task.get("status") != "committed":
            findings.append(Finding(
                "HIGH", "task_committed_in_git_not_in_progress",
                f"Task {tid} is referenced by a real commit in git but the checkpoint "
                f"still marks it '{task.get('status')}'. Update its status to "
                "'committed' with the commit_sha."))

    return CheckpointConsistencyReport(
        committed_in_progress=len(committed_ids),
        findings=tuple(findings),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--progress", type=Path, required=True)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if not args.progress.exists():
        print(f"progress file not found: {args.progress}", file=sys.stderr)
        return 2
    if not args.plan.exists():
        print(f"plan file not found: {args.plan}", file=sys.stderr)
        return 2

    try:
        progress = json.loads(args.progress.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        print(f"progress malformed: {exc}", file=sys.stderr)
        return 2

    plan_ids = plan_task_ids_from_text(args.plan.read_text(encoding="utf-8-sig"))
    report = check_checkpoint_consistency(progress, args.repo_root, plan_ids)

    if args.json:
        print(json.dumps({
            "committed_in_progress": report.committed_in_progress,
            "status": report.status,
            "findings": [{"severity": f.severity, "code": f.code, "message": f.message}
                         for f in report.findings],
            "has_high_or_blocker": report.has_high_or_blocker,
        }, indent=2))
    else:
        print(f"Checkpoint consistency: {report.status} "
              f"({report.committed_in_progress} committed task(s))")
        for f in report.findings:
            print(f"  [{f.severity}] {f.code}: {f.message}")

    return 1 if report.has_high_or_blocker else 0


if __name__ == "__main__":
    sys.exit(main())
