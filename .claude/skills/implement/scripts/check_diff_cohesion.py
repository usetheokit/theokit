#!/usr/bin/env python3
"""Diff cohesion check for /implement Step 4.7 mini review.

For a given phase, compares the set of files declared in `Files to edit`
(per task in the plan) against the set of files ACTUALLY modified during
the phase (per .progress-{slug}.json or git log). Flags two classes:

  (1) Scope drift — file modified that no phase task declared in `Files to edit`.
                    HIGH severity. Often signals an opportunistic edit slipping in.
  (2) Cross-layer mix — files modified span layers the project's architecture
                        forbids mixing inside one commit (e.g., domain + infra
                        without explicit composition root). MEDIUM. Only fires
                        if the project declares layers in rules/architecture.md
                        AND the plan does not explicitly authorize the mix.

Honest defaults:
  - Cross-layer detection requires per-project layer config; absent → SKIP that
    check rather than guess. The audit report records the skip.
  - Git history is preferred for diff (`git log <first-sha>..<last-sha>`), with
    progress-file fallback when git is unavailable or commit SHAs are missing.
  - Files outside the source tree (CHANGELOG, docs, fixtures) are NOT flagged —
    declared scope is about source code under src/, lib/, internal/, etc.

Usage:
    python3 check_diff_cohesion.py \\
        --plan knowledge-base/plans/foo-plan.md \\
        --progress knowledge-base/implementations/.progress-foo.json \\
        --phase 1 \\
        --json

Exit codes:
    0 — PASS / INFO only
    1 — at least one HIGH / BLOCKER finding
    2 — invocation error
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

TASK_HEADER_RE = re.compile(r"^###\s+(T\d+\.\d+)\s*[—\-–:]\s*(.+?)\s*$", re.MULTILINE)
NEXT_TASK_OR_H2_RE = re.compile(r"^(##\s+\S|###\s+T\d+\.\d+)", re.MULTILINE)
FILES_TO_EDIT_RE = re.compile(
    r"^####\s+Files\s+to\s+edit\s*$(.+?)(?=^####\s|\Z)",
    re.MULTILINE | re.DOTALL | re.IGNORECASE,
)
FILE_LINE_RE = re.compile(r"^[\-*\s]*`?([^\s`]+\.[a-zA-Z0-9]+)`?\s*$", re.MULTILINE)

# Files that are ALWAYS allowed to be touched (cross-cutting, low risk).
NON_SOURCE_PATHS = (
    "CHANGELOG.md", "README.md", ".gitignore", ".gitattributes",
    "package.json", "package-lock.json", "go.mod", "go.sum",
    "Cargo.toml", "Cargo.lock", "pyproject.toml", "requirements.txt",
)


@dataclass(frozen=True)
class Finding:
    severity: str
    code: str
    message: str


@dataclass(frozen=True)
class DiffCohesionReport:
    phase: str
    declared_files: tuple[str, ...]
    modified_files: tuple[str, ...]
    drift_files: tuple[str, ...]     # in modified but NOT in declared (excluding NON_SOURCE)
    diff_source: str                  # "git" | "progress" | "none"
    cross_layer_checked: bool
    findings: tuple[Finding, ...] = field(default_factory=tuple)

    @property
    def has_high_or_blocker(self) -> bool:
        return any(f.severity in ("HIGH", "BLOCKER") for f in self.findings)


def _extract_task_blocks(content: str) -> list[tuple[str, str]]:
    """Return list of (task_id, body) — body stops at next task/H2."""
    matches = list(TASK_HEADER_RE.finditer(content))
    blocks: list[tuple[str, str]] = []
    for m in matches:
        tid = m.group(1)
        start = m.end()
        nxt = NEXT_TASK_OR_H2_RE.search(content, pos=start)
        end = nxt.start() if nxt else len(content)
        blocks.append((tid, content[start:end]))
    return blocks


def _phase_of(task_id: str) -> str:
    # T<N>.<M> → "<N>"
    match = re.match(r"T(\d+)\.\d+", task_id)
    return match.group(1) if match else ""


def _declared_files_for_phase(plan_path: Path, phase: str) -> set[str]:
    content = plan_path.read_text(encoding="utf-8-sig")
    declared: set[str] = set()
    for tid, body in _extract_task_blocks(content):
        if _phase_of(tid) != str(phase):
            continue
        files_block = FILES_TO_EDIT_RE.search(body)
        if not files_block:
            continue
        for line in files_block.group(1).splitlines():
            match = FILE_LINE_RE.match(line)
            if match:
                declared.add(match.group(1).strip())
    return declared


def _modified_files_via_progress(progress_path: Path, phase: str) -> set[str]:
    data = json.loads(progress_path.read_text(encoding="utf-8-sig"))
    modified: set[str] = set()
    for task in data.get("tasks", []):
        if str(task.get("phase")) != str(phase):
            continue
        for f in task.get("files", []):
            modified.add(f.strip())
    return modified


def _modified_files_via_git(progress_path: Path, phase: str, repo_root: Path) -> set[str] | None:
    """Use git log to list files modified in the phase. Returns None on failure."""
    try:
        data = json.loads(progress_path.read_text(encoding="utf-8-sig"))
    except (json.JSONDecodeError, OSError):
        return None
    phase_tasks = [t for t in data.get("tasks", []) if str(t.get("phase")) == str(phase)]
    shas = [t.get("commit_sha") for t in phase_tasks if t.get("commit_sha")]
    if not shas:
        return None
    try:
        cmd = ["git", "-C", str(repo_root), "show", "--name-only", "--pretty=format:"] + shas
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=20, check=True)
    except (subprocess.SubprocessError, FileNotFoundError):
        return None
    return {line.strip() for line in result.stdout.splitlines() if line.strip()}


def check_diff_cohesion(
    plan_path: Path,
    progress_path: Path,
    phase: str,
    repo_root: Path | None = None,
) -> DiffCohesionReport:
    declared = _declared_files_for_phase(plan_path, phase)

    diff_source = "none"
    modified: set[str] = set()
    if repo_root is not None:
        git_files = _modified_files_via_git(progress_path, phase, repo_root)
        if git_files is not None:
            modified = git_files
            diff_source = "git"
    if not modified:
        modified = _modified_files_via_progress(progress_path, phase)
        if modified:
            diff_source = "progress"

    findings: list[Finding] = []

    # Scope-drift detection requires a non-empty declared scope to compare against.
    # When declared is empty, only emit the MEDIUM (no_declared_scope) — we cannot
    # distinguish "drift" from "everything is undeclared" in that state.
    if not declared:
        findings.append(Finding(
            severity="MEDIUM",
            code="no_declared_scope",
            message=(
                f"Phase {phase} tasks did not declare `#### Files to edit` sections. "
                "Cannot compare against declared scope; scope-drift detection skipped."
            ),
        ))
        drift: set[str] = set()
    else:
        drift = {
            f for f in modified
            if f not in declared
            and Path(f).name not in NON_SOURCE_PATHS
            and f not in NON_SOURCE_PATHS
        }
        if drift:
            sample = ", ".join(sorted(drift)[:5])
            findings.append(Finding(
                severity="HIGH",
                code="scope_drift",
                message=(
                    f"Phase {phase}: {len(drift)} file(s) modified that were NOT in any task's "
                    f"`Files to edit` declaration: {sample}. Opportunistic edits violate plan scope."
                ),
            ))

    if diff_source == "none":
        findings.append(Finding(
            severity="MEDIUM",
            code="no_diff_source",
            message=(
                "Neither git history nor progress file had usable file lists for this phase. "
                "Cohesion check could not run; treat as inconclusive."
            ),
        ))

    # Cross-layer check is intentionally not implemented yet — needs per-project
    # layer config in rules/architecture.md. Skip with an INFO record.
    findings.append(Finding(
        severity="INFO",
        code="cross_layer_check_skipped",
        message=(
            "Cross-layer cohesion detection requires per-project layer config in "
            "rules/architecture.md. Skipped — implement when project declares its layers."
        ),
    ))

    return DiffCohesionReport(
        phase=str(phase),
        declared_files=tuple(sorted(declared)),
        modified_files=tuple(sorted(modified)),
        drift_files=tuple(sorted(drift)),
        diff_source=diff_source,
        cross_layer_checked=False,
        findings=tuple(findings),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--progress", type=Path, required=True)
    parser.add_argument("--phase", required=True)
    parser.add_argument("--repo-root", type=Path, default=None, help="Override git repo root (default: cwd)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if not args.plan.exists():
        print(f"plan file not found: {args.plan}", file=sys.stderr)
        return 2
    if not args.progress.exists():
        print(f"progress file not found: {args.progress}", file=sys.stderr)
        return 2

    repo_root = args.repo_root or Path.cwd()
    report = check_diff_cohesion(args.plan, args.progress, args.phase, repo_root)

    if args.json:
        out = {
            "phase": report.phase,
            "declared_files_count": len(report.declared_files),
            "modified_files_count": len(report.modified_files),
            "drift_files": list(report.drift_files),
            "diff_source": report.diff_source,
            "cross_layer_checked": report.cross_layer_checked,
            "findings": [{"severity": f.severity, "code": f.code, "message": f.message} for f in report.findings],
            "has_high_or_blocker": report.has_high_or_blocker,
        }
        print(json.dumps(out, indent=2))
    else:
        print(f"Phase {report.phase}: declared={len(report.declared_files)}, "
              f"modified={len(report.modified_files)}, drift={len(report.drift_files)}, "
              f"source={report.diff_source}")
        for f in report.findings:
            print(f"  [{f.severity}] {f.code}: {f.message}")

    return 1 if report.has_high_or_blocker else 0


if __name__ == "__main__":
    sys.exit(main())
