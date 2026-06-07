#!/usr/bin/env python3
"""Wiring triad checker — enforces 3 pillars during /implement halt-loop.

The HARD GATE that converts "code that compiles" + "tests pass" into "implementation
is integrated into the system":

  (a) Static caller    — at least 1 production caller (non-test) references the symbol
  (b) Integration test — at least 1 file under tests/integration/ exercises the symbol
                         OR an explicit ADR-DEFER-WIRING-B marker exists in implementation contract
  (c) Runtime metric   — if plan declared a metric, .wiring-evidence.json shows count > 0
                         OR no metric declared (pillar n/a)

Exit codes:
  0 — All required pillars PASS (any deferred via ADR is documented)
  1 — At least one pillar FAIL (cannot commit)
  2 — Error (project root not found, symbol not provided, etc.)
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


PRODUCTION_DIR_NAMES = ("src", "lib", "packages")
TEST_DIR_NAMES = ("test", "tests", "__tests__", "spec")
INTEGRATION_DIR_NAMES = ("integration", "e2e")

# Lines that DEFINE a symbol rather than CALL it. A file whose only occurrences of
# the symbol match these patterns is the definition site, not a caller.
_DEFINITION_PATTERNS = (
    r"^\s*(?:export\s+)?(?:async\s+)?function\s+{sym}\b",
    r"^\s*(?:export\s+)?(?:abstract\s+)?class\s+{sym}\b",
    r"^\s*(?:export\s+)?interface\s+{sym}\b",
    r"^\s*(?:export\s+)?type\s+{sym}\s*=",
    r"^\s*(?:export\s+)?(?:const|let|var)\s+{sym}\b",
    r"^\s*(?:export\s+)?enum\s+{sym}\b",
    r"^\s*(?:async\s+)?def\s+{sym}\b",
    r"^\s*class\s+{sym}\b",
    r"^\s*export\s+default\s+(?:function|class)?\s*{sym}\b",
)


def _find_project_root(start: Path) -> Path:
    current = start.resolve()
    for _ in range(20):
        if (current / ".claude").exists() or (current / ".git").exists():
            return current
        if current == current.parent:
            break
        current = current.parent
    return start.resolve()


def _is_definition_only(path: Path, symbol: str) -> bool:
    """True if every occurrence of `symbol` in `path` is on a definition line.

    Used by pillar (a) to exclude the file where the symbol is declared from the
    caller count — a `grep -l 'foo'` will match the file that declares `function foo`
    even if no one else calls it, producing a false PASS.
    """
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False

    word_re = re.compile(rf"\b{re.escape(symbol)}\b")
    def_res = [re.compile(p.format(sym=re.escape(symbol)), re.MULTILINE) for p in _DEFINITION_PATTERNS]

    occurrence_lines = {i for i, line in enumerate(text.splitlines()) if word_re.search(line)}
    if not occurrence_lines:
        return False  # not really our file

    definition_lines: set[int] = set()
    for dre in def_res:
        for match in dre.finditer(text):
            line_idx = text.count("\n", 0, match.start())
            definition_lines.add(line_idx)

    return occurrence_lines.issubset(definition_lines)


def _grep_symbol(project_root: Path, symbol: str, include_globs: list[str], exclude_dirs: list[str]) -> list[Path]:
    """Find files containing the symbol. Uses grep; falls back to manual scan if grep unavailable."""
    try:
        cmd = ["grep", "-rl"]
        for inc in include_globs:
            cmd.extend(["--include", inc])
        for exc in exclude_dirs:
            cmd.extend(["--exclude-dir", exc])
        cmd.extend([f"\\b{symbol}\\b", str(project_root)])
        # Use word-boundary-ish via shell regex; grep -E for ERE
        result = subprocess.run(
            ["grep", "-rlE"] + [arg for arg in cmd[2:]],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode > 1:
            return []
        return [Path(p) for p in result.stdout.strip().splitlines() if p]
    except (subprocess.SubprocessError, FileNotFoundError):
        return []


def check_pillar_a_static_caller(project_root: Path, symbol: str) -> dict[str, Any]:
    """Find at least 1 production caller (non-test) under src/, lib/, or packages/.

    Files where `symbol` appears ONLY in definition position (function/class/interface
    declaration) are excluded — those are the origin, not callers. A symbol with only
    its own definition and no callers is dead code, which is what this pillar catches.
    """
    matches = _grep_symbol(
        project_root,
        symbol,
        include_globs=["*.ts", "*.tsx", "*.js", "*.mjs", "*.py"],
        exclude_dirs=["node_modules", ".git", "dist", "build", "tests", "test", "__tests__", "spec"],
    )
    # Exclude files with "test" / "spec" / "fixture" / "mock" in basename
    production_files = [
        p for p in matches
        if not any(t in p.name.lower() for t in ("test", "spec", "fixture", "mock"))
    ]
    # Exclude files where the symbol appears ONLY on definition lines (origin, not caller)
    production_callers = [p for p in production_files if not _is_definition_only(p, symbol)]
    definition_only_files = [p for p in production_files if _is_definition_only(p, symbol)]

    if production_callers:
        return {
            "pillar": "a_static_caller",
            "status": "PASS",
            "callers_count": len(production_callers),
            "callers_sample": [str(p.relative_to(project_root)) for p in production_callers[:3]],
            "definition_only_excluded": [str(p.relative_to(project_root)) for p in definition_only_files[:3]],
        }
    return {
        "pillar": "a_static_caller",
        "status": "FAIL",
        "callers_count": 0,
        "definition_only_excluded": [str(p.relative_to(project_root)) for p in definition_only_files[:3]],
        "reason": f"Symbol '{symbol}' has zero production callers — only definition site(s) found, no usage",
        "recommended_action": "Add a functionally necessary caller (not a no-op) OR remove the symbol",
    }


def check_pillar_b_integration_test(project_root: Path, symbol: str, deferral_path: Path | None) -> dict[str, Any]:
    """Find at least 1 file under tests/integration/ referencing the symbol, OR a symbol-scoped ADR-DEFER marker.

    The deferral marker MUST name the symbol explicitly to count:
        <!-- ADR-DEFER-WIRING-B: mySymbol: integration infra ships in v0.2 -->
    A bare marker is rejected — otherwise one deferral could silently cover every
    pillar (b) failure in the document. The symbol payload binds the deferral to
    a single function/class/type.
    """
    # Check for explicit symbol-scoped deferral marker in implementation contract
    if deferral_path and deferral_path.exists():
        text = deferral_path.read_text(encoding="utf-8-sig")
        # Marker shape: <!-- ADR-DEFER-WIRING-B: <symbol>: <reason> -->
        # Both <symbol> and <reason> required; symbol is matched literally.
        symbol_marker_re = re.compile(
            rf"<!--\s*ADR-DEFER-WIRING-B:\s*{re.escape(symbol)}\s*:\s*[^>]+?-->",
            re.IGNORECASE | re.DOTALL,
        )
        if symbol_marker_re.search(text):
            return {
                "pillar": "b_integration_test",
                "status": "DEFER",
                "reason": f"Explicit ADR-DEFER-WIRING-B marker scoped to '{symbol}' found",
                "deferred_via": str(deferral_path.relative_to(project_root)),
            }
        # Detect bare markers and warn — they no longer count
        bare_marker_re = re.compile(r"<!--\s*ADR-DEFER-WIRING-B:", re.IGNORECASE)
        if bare_marker_re.search(text):
            return {
                "pillar": "b_integration_test",
                "status": "FAIL",
                "reason": (
                    f"Found ADR-DEFER-WIRING-B marker(s) in {deferral_path.name}, but none "
                    f"name symbol '{symbol}'. Required format: "
                    f"<!-- ADR-DEFER-WIRING-B: {symbol}: <reason> -->"
                ),
                "recommended_action": "Bind the deferral marker to this specific symbol or add a real integration test.",
            }

    # Search tests/integration/ for symbol references
    integration_dirs = []
    for tdir in TEST_DIR_NAMES:
        for idir in INTEGRATION_DIR_NAMES:
            candidate = project_root / tdir / idir
            if candidate.exists():
                integration_dirs.append(candidate)

    if not integration_dirs:
        return {
            "pillar": "b_integration_test",
            "status": "FAIL",
            "reason": "No tests/integration/ directory found in project",
            "recommended_action": "Create tests/integration/ AND add a test exercising the symbol, OR add ADR-DEFER-WIRING-B marker",
        }

    test_matches: list[Path] = []
    for idir in integration_dirs:
        test_matches.extend(_grep_symbol(
            idir,
            symbol,
            include_globs=["*.ts", "*.tsx", "*.js", "*.mjs", "*.py"],
            exclude_dirs=["node_modules", ".git"],
        ))

    if test_matches:
        return {
            "pillar": "b_integration_test",
            "status": "PASS",
            "tests_count": len(test_matches),
            "tests_sample": [str(p.relative_to(project_root)) for p in test_matches[:3]],
        }
    return {
        "pillar": "b_integration_test",
        "status": "FAIL",
        "tests_count": 0,
        "reason": f"Symbol '{symbol}' is not exercised in any integration test",
        "recommended_action": "Add tests/integration/*.test.ts that exercises the symbol via a real boundary scenario, OR add ADR-DEFER-WIRING-B marker",
    }


def check_pillar_c_runtime_metric(project_root: Path, metric: str | None) -> dict[str, Any]:
    """If metric declared, verify .wiring-evidence.json shows count > 0 for it. Otherwise n/a."""
    if not metric:
        return {
            "pillar": "c_runtime_metric",
            "status": "N/A",
            "reason": "No runtime metric declared for this task",
        }

    evidence_path = project_root / ".wiring-evidence.json"
    if not evidence_path.exists():
        return {
            "pillar": "c_runtime_metric",
            "status": "FAIL",
            "reason": f".wiring-evidence.json does not exist; cannot verify metric '{metric}'",
            "recommended_action": f"Run an integration test that emits the metric, OR add evidence collection infrastructure; or use ADR to defer pillar (c)",
        }

    try:
        evidence = json.loads(evidence_path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        return {
            "pillar": "c_runtime_metric",
            "status": "FAIL",
            "reason": f".wiring-evidence.json is malformed: {exc}",
        }

    count = evidence.get(metric, 0)
    if isinstance(count, (int, float)) and count > 0:
        return {
            "pillar": "c_runtime_metric",
            "status": "PASS",
            "metric": metric,
            "count_observed": count,
        }
    return {
        "pillar": "c_runtime_metric",
        "status": "FAIL",
        "metric": metric,
        "count_observed": count,
        "reason": f"Metric '{metric}' observed count is {count} (expected > 0); integration test does not exercise the metric path",
    }


def aggregate_verdict(pillars: list[dict[str, Any]]) -> tuple[str, list[str]]:
    """HALT if any required pillar is FAIL. DEFER counts as conditional pass."""
    fails = [p["pillar"] for p in pillars if p["status"] == "FAIL"]
    defers = [p["pillar"] for p in pillars if p["status"] == "DEFER"]

    if fails:
        verdict = "HALT"
        notes = [f"Failed pillars: {fails}"]
        if defers:
            notes.append(f"Deferred (still need ADR confirmation): {defers}")
        return verdict, notes

    notes = []
    if defers:
        notes.append(f"Deferred via ADR: {defers}")
    return "PASS", notes


def main() -> int:
    parser = argparse.ArgumentParser(description="Wiring triad checker for /implement halt-loop.")
    parser.add_argument("--symbol", required=True, help="Symbol name (function/class/type) to verify wiring for")
    parser.add_argument(
        "--metric",
        default=None,
        help="Optional runtime metric name declared in the plan; if absent, pillar (c) is n/a",
    )
    parser.add_argument(
        "--deferral-path",
        type=Path,
        default=None,
        help="Path to the implementation contract markdown (for ADR-DEFER-WIRING-B marker check)",
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=None,
        help="Override project root detection",
    )
    args = parser.parse_args()

    project_root = args.project_root if args.project_root else _find_project_root(Path.cwd())

    pillar_a = check_pillar_a_static_caller(project_root, args.symbol)
    pillar_b = check_pillar_b_integration_test(project_root, args.symbol, args.deferral_path)
    pillar_c = check_pillar_c_runtime_metric(project_root, args.metric)

    pillars = [pillar_a, pillar_b, pillar_c]
    verdict, notes = aggregate_verdict(pillars)

    output = {
        "symbol": args.symbol,
        "project_root": str(project_root),
        "verdict": verdict,
        "notes": notes,
        "pillars": pillars,
    }
    print(json.dumps(output, indent=2))

    return 0 if verdict == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
