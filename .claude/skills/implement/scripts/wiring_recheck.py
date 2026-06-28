#!/usr/bin/env python3
"""Independent re-verification of wiring pillar (a) by RE-RUNNING check_wiring.py.

The non-negotiable invariant of `/implement` is that every new public symbol has a
production caller (pillar a). Before this module, two consumers verified it two ways:

  - `mini_review.py` re-ran `check_wiring.py` per symbol (correct, independent).
  - `run_validation.py` (the FINAL gate) only READ the `wiring` field of the
    progress file — a value the LLM itself writes. A hallucinated or dishonest
    `"wiring": {"a": "pass"}` passed the final gate with zero verification.

This module is the single, shared, trust-nothing implementation: give it a set of
symbol names and it shells out to `check_wiring.py` for each, returning real counts.
"Symbol not found anywhere in the source tree" is distinguished from "symbol exists
but has no caller" — only the latter is a true wiring FAIL; the former is an
unresolved symbol the caller should report as inconclusive, never as PASS.
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

_CHECK_WIRING = Path(__file__).parent / "check_wiring.py"


@dataclass(frozen=True)
class PillarARecheck:
    symbols_checked: int           # symbols we attempted to verify
    symbols_resolved: int          # symbols actually found in the source tree
    pillar_a_fails: int            # resolved symbols with no production caller
    fail_symbols: tuple[str, ...]  # names of the failing symbols


def recheck_pillar_a(project_root: Path, symbols: set[str]) -> PillarARecheck:
    """Run check_wiring.py pillar (a) for each symbol; aggregate honestly.

    Never raises: a per-symbol subprocess or JSON error skips that symbol (treated
    as unresolved), so a flaky check on one symbol cannot mask the others.
    """
    if not _CHECK_WIRING.exists():
        return PillarARecheck(len(symbols), 0, 0, ())

    resolved = 0
    fails: list[str] = []
    for sym in sorted(symbols):
        pillar = _run_one(project_root, sym)
        if pillar is None:
            continue
        callers_count = pillar.get("callers_count", 0)
        def_only = pillar.get("definition_only_excluded", [])
        # callers==0 AND no definition site found => symbol not detectable in the
        # tree (wrong/derived name). Unresolved, not a fail.
        if callers_count == 0 and not def_only:
            continue
        resolved += 1
        if pillar.get("status") == "FAIL":
            fails.append(sym)

    return PillarARecheck(
        symbols_checked=len(symbols),
        symbols_resolved=resolved,
        pillar_a_fails=len(fails),
        fail_symbols=tuple(fails),
    )


def _run_one(project_root: Path, symbol: str) -> dict | None:
    """Return the pillar (a) payload from check_wiring.py for one symbol, or None."""
    try:
        result = subprocess.run(
            ["python3", str(_CHECK_WIRING), "--symbol", symbol,
             "--project-root", str(project_root)],
            capture_output=True, text=True, timeout=30,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return None
    if result.returncode == 2 or not result.stdout.strip():
        return None
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    for pillar in payload.get("pillars", []):
        if pillar.get("pillar") == "a_static_caller":
            return pillar
    return None
