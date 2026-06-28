#!/usr/bin/env python3
"""Test-obligation gate for /implement (GAP 6).

The plan template makes two conditional promises that `plan-confidence` only checks
exist on the PLAN side — nothing on the implement side confirmed the tests were
actually written:

  - `#### Concurrency tests` per task (unless `(none — single-threaded)`).
  - `## Failure scenarios` per external dependency (unless `(none — no external
    I/O touched)`).

A generic `npm test` / `pytest` run is green even when those specific tests were
never written: single-threaded execution always interleaves cleanly, and happy-path
suites never hit a 503. This gate parses the declared obligations and scans the test
tree for at least one matching test.

Honest limits — this is a HEURISTIC, not proof:
  - It cannot confirm a test was RUN, nor that it exercises the exact scenario.
  - It only fires HIGH on TOTAL ABSENCE: an obligation exists and NOT ONE test in
    the tree carries any concurrency / failure signal. When some signal is present
    it stays silent rather than risk a false positive on a test it failed to
    recognize. The honest floor: "the plan promised race/chaos tests and there are
    none at all" is a real bypass; partial coverage is left to human review.

Exit codes (CLI): 0 — no HIGH/BLOCKER; 1 — HIGH/BLOCKER; 2 — invocation error.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

_CONC_SECTION_RE = re.compile(r"^####\s+Concurrency tests\b.*$", re.MULTILINE | re.IGNORECASE)
_FAIL_SECTION_RE = re.compile(r"^##\s+Failure scenarios\b.*$", re.MULTILINE | re.IGNORECASE)
_ANY_HEADER_RE = re.compile(r"^#{1,6}\s", re.MULTILINE)

# Signals that a test actually exercises concurrency.
_CONCURRENCY_SIGNALS = (
    "-race", "loom", "waitgroup", "promise.all", "countdownlatch", "jcstress",
    "worker_threads", "concurrent", "goroutine", "sync.mutex", "atomic", "threading",
    "race", "stress", "asyncio.gather", "join()", "barrier",
)
# Signals that a test actually exercises a failure / chaos path.
_FAILURE_SIGNALS = (
    "503", "500", "5xx", "timeout", "toxiproxy", "pg_terminate", "testcontainers",
    "circuit", "breaker", "retry", "httpx_mock", "connection reset", "rate limit",
    "rate_limit", "chaos", "failure", "connreset", "econnreset", "backoff",
)

_TEST_NAME_HINTS = ("test", "spec")
# Only real test CODE is scanned — never the plan/docs (which describe the tests and
# would falsely match every signal).
_CODE_EXTS = {".py", ".ts", ".tsx", ".js", ".mjs", ".jsx", ".go", ".rs", ".java", ".rb", ".kt"}


@dataclass(frozen=True)
class Obligation:
    kind: str   # "concurrency" | "failure"
    detail: str


@dataclass(frozen=True)
class Finding:
    severity: str
    code: str
    message: str


@dataclass(frozen=True)
class TestObligationsReport:
    obligations: tuple[Obligation, ...]
    findings: tuple[Finding, ...] = field(default_factory=tuple)

    @property
    def has_high_or_blocker(self) -> bool:
        return any(f.severity in ("HIGH", "BLOCKER") for f in self.findings)

    @property
    def status(self) -> str:
        if not self.obligations:
            return "SKIP"
        if self.has_high_or_blocker:
            return "FAIL"
        if self.findings:
            return "WARN"
        return "PASS"


def _section_body(content: str, match: re.Match) -> str:
    start = match.end()
    nxt = _ANY_HEADER_RE.search(content, pos=start)
    return content[start: nxt.start() if nxt else len(content)]


def parse_obligations(plan_path: Path) -> list[Obligation]:
    content = plan_path.read_text(encoding="utf-8-sig")
    obligations: list[Obligation] = []

    for m in _CONC_SECTION_RE.finditer(content):
        body = _section_body(content, m).strip()
        if not body:
            continue
        if "single-threaded" in body.lower():
            continue  # explicit escape
        obligations.append(Obligation(kind="concurrency", detail=body.splitlines()[0][:120]))

    for m in _FAIL_SECTION_RE.finditer(content):
        body = _section_body(content, m).strip()
        if not body:
            continue
        if "no external i/o" in body.lower():
            continue  # explicit escape
        # Require at least one content row beyond the table header separator.
        rows = [ln for ln in body.splitlines() if ln.strip() and not set(ln.strip()) <= set("|-: ")]
        if rows:
            obligations.append(Obligation(kind="failure", detail=rows[0][:120]))

    return obligations


def _iter_test_files(repo_root: Path):
    for path in repo_root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in _CODE_EXTS:
            continue
        if any(part in (".git", "node_modules", "__pycache__", ".venv") for part in path.parts):
            continue
        try:
            rel_parts = [p.lower() for p in path.relative_to(repo_root).parts]
        except ValueError:
            rel_parts = [path.name.lower()]
        in_test_dir = any(h in part for part in rel_parts[:-1] for h in _TEST_NAME_HINTS)
        is_test_file = any(h in path.name.lower() for h in _TEST_NAME_HINTS)
        if in_test_dir or is_test_file:
            yield path


def _tree_has_signal(repo_root: Path, signals: tuple[str, ...]) -> bool:
    for path in _iter_test_files(repo_root):
        try:
            text = path.read_text(encoding="utf-8", errors="ignore").lower()
        except OSError:
            continue
        if any(sig in text for sig in signals):
            return True
    return False


def check_test_obligations(plan_path: Path, repo_root: Path | None = None) -> TestObligationsReport:
    obligations = parse_obligations(plan_path)
    if not obligations or repo_root is None:
        return TestObligationsReport(obligations=tuple(obligations))

    findings: list[Finding] = []
    kinds = {o.kind for o in obligations}

    if "concurrency" in kinds and not _tree_has_signal(repo_root, _CONCURRENCY_SIGNALS):
        findings.append(Finding(
            severity="HIGH",
            code="concurrency_tests_absent",
            message="Plan declares concurrency tests, but NO test in the tree carries "
                    "any concurrency signal (race detector, atomic-counter invariant, "
                    "WaitGroup/Promise.all barrier, etc.). A single-threaded suite does "
                    "not prove the race-free invariant.",
        ))

    if "failure" in kinds and not _tree_has_signal(repo_root, _FAILURE_SIGNALS):
        findings.append(Finding(
            severity="HIGH",
            code="failure_tests_absent",
            message="Plan declares failure scenarios for external I/O, but NO test in "
                    "the tree exercises a failure path (5xx/timeout/connection reset/"
                    "retry/circuit-breaker/chaos). Happy-path tests do not prove "
                    "resilience.",
        ))

    return TestObligationsReport(obligations=tuple(obligations), findings=tuple(findings))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if not args.plan.exists():
        print(f"plan file not found: {args.plan}", file=sys.stderr)
        return 2

    report = check_test_obligations(args.plan, repo_root=args.repo_root)

    if args.json:
        print(json.dumps({
            "obligations": [{"kind": o.kind, "detail": o.detail} for o in report.obligations],
            "status": report.status,
            "findings": [{"severity": f.severity, "code": f.code, "message": f.message}
                         for f in report.findings],
            "has_high_or_blocker": report.has_high_or_blocker,
        }, indent=2))
    else:
        print(f"Test obligations: {len(report.obligations)} ({report.status})")
        for f in report.findings:
            print(f"  [{f.severity}] {f.code}: {f.message}")

    return 1 if report.has_high_or_blocker else 0


if __name__ == "__main__":
    sys.exit(main())
