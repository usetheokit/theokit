#!/usr/bin/env python3
"""Acceptance-Criteria / DoD enforcement gate for /implement (GAP 1+2).

`run_validation.py` runs the test/typecheck/lint/coverage commands, but the plan's
Acceptance Criteria and DoD checkboxes were otherwise honored only by the LLM
ticking `- [x]` in the implementation contract — with no script confronting those
claims against reality. This gate closes that bypass in three ways:

  1. **Inventory** — parse every AC/DoD checkbox in the plan and categorize it, so
     the gate knows what was promised.
  2. **Enforce the mechanizable ones run_validation does NOT cover** — file-size
     budget (`<= N lines` per changed file) and CHANGELOG-updated, both checked
     against the real committed diff. A self-ticked `- [x]` cannot mask a 600-line
     file or a missing CHANGELOG entry.
  3. **Surface the non-mechanizable ones** — "backward compatibility preserved" and
     other claims a script cannot prove are reported as
     `criterion_requires_human_evidence` (LOW) so they are visible for review
     instead of laundered through as silently-accepted ticks.

Categories already covered elsewhere are tagged, not re-checked:
  coverage/lint/typecheck/test → run_validation; complexity → /code-quality;
  runtime_metric → wiring pillar (c).

Exit codes (CLI):
  0 — no HIGH/BLOCKER finding (PASS / WARN / SKIP)
  1 — at least one HIGH/BLOCKER (e.g. file-size budget blown)
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

# Headers whose checkbox body holds acceptance obligations.
_SECTION_RE = re.compile(
    r"^#{2,4}\s+.*(?:Acceptance Criteria|Definition of Done|\bDoD\b).*$",
    re.MULTILINE | re.IGNORECASE,
)
_ANY_HEADER_RE = re.compile(r"^#{1,6}\s", re.MULTILINE)
_CHECKBOX_RE = re.compile(r"^\s*[-*]\s*\[[ xX]\]\s*(.+?)\s*$", re.MULTILINE)
_FILE_SIZE_LIMIT_RE = re.compile(r"(\d{2,5})\s*lines", re.IGNORECASE)

_DEFAULT_FILE_SIZE_LIMIT = 500

# Categories run_validation / CQ / wiring already enforce — tagged, not re-checked.
_COVERED_ELSEWHERE = {
    "coverage": "run_validation",
    "lint": "run_validation",
    "typecheck": "run_validation",
    "test": "run_validation",
    "complexity": "code_quality",
    "runtime_metric": "wiring_pillar_c",
}
# Categories this gate cannot mechanically prove — surfaced for human review.
_NEEDS_EVIDENCE = {"backward_compat", "other"}


@dataclass(frozen=True)
class Criterion:
    text: str
    category: str


@dataclass(frozen=True)
class Finding:
    severity: str  # BLOCKER | HIGH | MEDIUM | LOW | INFO
    code: str
    message: str


@dataclass(frozen=True)
class AcceptanceReport:
    total_criteria: int
    by_category: dict[str, int]
    findings: tuple[Finding, ...] = field(default_factory=tuple)

    @property
    def has_high_or_blocker(self) -> bool:
        return any(f.severity in ("HIGH", "BLOCKER") for f in self.findings)

    @property
    def status(self) -> str:
        if self.total_criteria == 0:
            return "SKIP"
        if self.has_high_or_blocker:
            return "FAIL"
        if self.findings:
            return "WARN"
        return "PASS"


def categorize(text: str) -> str:
    """Map a criterion to a category by keyword. First match wins (order matters)."""
    t = text.lower()
    if "coverage" in t:
        return "coverage"
    if "lint" in t:
        return "lint"
    if "type error" in t or "typecheck" in t or "type-check" in t or "type errors" in t:
        return "typecheck"
    if "complexity" in t or "cyclomatic" in t:
        return "complexity"
    if "changelog" in t:
        return "changelog"
    if "backward" in t or "compatib" in t:
        return "backward_compat"
    if "metric" in t or "counter" in t:
        return "runtime_metric"
    if "line" in t or "size" in t:
        return "file_size"
    if "test" in t:
        return "test"
    return "other"


def parse_criteria(plan_path: Path) -> list[Criterion]:
    content = plan_path.read_text(encoding="utf-8-sig")
    criteria: list[Criterion] = []
    for section in _SECTION_RE.finditer(content):
        start = section.end()
        nxt = _ANY_HEADER_RE.search(content, pos=start)
        body = content[start: nxt.start() if nxt else len(content)]
        for box in _CHECKBOX_RE.finditer(body):
            text = box.group(1).strip()
            criteria.append(Criterion(text=text, category=categorize(text)))
    return criteria


def _changed_files(repo_root: Path, shas: list[str]) -> list[str]:
    """Files touched by the given commits (name-only). Empty on any git failure."""
    if not shas:
        return []
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_root), "show", "--name-only", "--pretty=format:", *shas],
            capture_output=True, text=True, timeout=20, check=True,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return []
    seen: list[str] = []
    for line in result.stdout.splitlines():
        f = line.strip()
        if f and f not in seen:
            seen.append(f)
    return seen


def _file_size_limit(criteria: list[Criterion]) -> int:
    for c in criteria:
        if c.category == "file_size":
            m = _FILE_SIZE_LIMIT_RE.search(c.text)
            if m:
                return int(m.group(1))
    return _DEFAULT_FILE_SIZE_LIMIT


def check_acceptance_criteria(
    plan_path: Path,
    repo_root: Path | None = None,
    shas: list[str] | None = None,
) -> AcceptanceReport:
    criteria = parse_criteria(plan_path)
    by_category: dict[str, int] = {}
    for c in criteria:
        by_category[c.category] = by_category.get(c.category, 0) + 1

    if not criteria:
        return AcceptanceReport(total_criteria=0, by_category={})

    findings: list[Finding] = []
    shas = shas or []
    changed = _changed_files(repo_root, shas) if repo_root is not None else []

    # --- file_size budget (mechanizable, NOT covered by run_validation) ----------
    if by_category.get("file_size") and repo_root is not None and changed:
        limit = _file_size_limit(criteria)
        for rel in changed:
            path = repo_root / rel
            if not path.is_file():
                continue
            try:
                loc = sum(1 for _ in path.open(encoding="utf-8", errors="ignore"))
            except OSError:
                continue
            if loc > limit:
                findings.append(Finding(
                    severity="HIGH",
                    code="file_size_exceeded",
                    message=f"`{rel}` has {loc} lines, exceeding the plan's "
                            f"<= {limit}-line acceptance criterion.",
                ))

    # --- CHANGELOG updated (mechanizable) ----------------------------------------
    if by_category.get("changelog") and repo_root is not None and shas:
        if not any(Path(f).name == "CHANGELOG.md" for f in changed):
            findings.append(Finding(
                severity="MEDIUM",
                code="changelog_not_updated",
                message="Plan DoD requires a CHANGELOG.md entry, but no committed "
                        "diff in this implementation touched CHANGELOG.md "
                        "(Unbreakable Rule 6).",
            ))

    # --- non-mechanizable criteria: surface for human review ---------------------
    needs_evidence = [c for c in criteria if c.category in _NEEDS_EVIDENCE]
    if needs_evidence:
        sample = "; ".join(c.text for c in needs_evidence[:4])
        findings.append(Finding(
            severity="LOW",
            code="criterion_requires_human_evidence",
            message=f"{len(needs_evidence)} acceptance criterion(s) cannot be "
                    f"machine-verified and need explicit evidence in review (not a "
                    f"silently-ticked box): {sample}",
        ))

    return AcceptanceReport(
        total_criteria=len(criteria),
        by_category=by_category,
        findings=tuple(findings),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, default=None)
    parser.add_argument("--sha", action="append", default=[], help="commit SHA (repeatable)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if not args.plan.exists():
        print(f"plan file not found: {args.plan}", file=sys.stderr)
        return 2

    report = check_acceptance_criteria(args.plan, repo_root=args.repo_root, shas=args.sha)

    if args.json:
        print(json.dumps({
            "total_criteria": report.total_criteria,
            "by_category": report.by_category,
            "status": report.status,
            "findings": [{"severity": f.severity, "code": f.code, "message": f.message}
                         for f in report.findings],
            "has_high_or_blocker": report.has_high_or_blocker,
        }, indent=2))
    else:
        print(f"Acceptance criteria: {report.total_criteria} ({report.status})")
        for f in report.findings:
            print(f"  [{f.severity}] {f.code}: {f.message}")

    return 1 if report.has_high_or_blocker else 0


if __name__ == "__main__":
    sys.exit(main())
