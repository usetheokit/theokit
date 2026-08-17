#!/usr/bin/env python3
"""Authoritative public-symbol derivation from git diffs.

The wiring triad (`check_wiring.py`) verifies a symbol once it is NAMED. The open
question both `run_validation.py` and `mini_review.py` faced was *which* symbols to
verify. Trusting the LLM-authored progress file (its self-reported `wiring` field)
or a filename-stem heuristic both let an un-wired symbol slip through silently.

This module answers "which symbols did this work actually introduce?" from the one
source the LLM cannot fake without lying in git: the diff of the committed tasks.
We parse the unified diff and match symbol-definition shapes against ADDED ('+')
lines only — so renamed/moved code that merely shifts a definition is not re-counted
unless it is genuinely new.

Honest limits:
  - Regex-based, not a real parser: it recognizes the common public-definition
    shapes (function/class/interface/type/enum/exported const) across Python and
    TS/JS. Exotic forms (decorators-as-factories, computed exports) are missed.
  - Returns an empty set — never raises — when git is unavailable or no SHA is
    given. Callers MUST treat "no symbols derivable" as inconclusive, not as PASS.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

# Capture the symbol NAME from a definition on an added line. These mirror the
# (placeholder-based) _DEFINITION_PATTERNS in check_wiring.py, but capture the name
# instead of matching a known one. Kept separate on purpose: one detects "is this
# line the definition of symbol X", the other answers "what symbol does this line
# define" — different questions, different shapes.
_ADDED_DEF_PATTERNS: tuple[str, ...] = (
    r"(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)",
    r"(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)",
    r"(?:export\s+)?interface\s+(\w+)",
    r"(?:export\s+)?type\s+(\w+)\s*=",
    r"(?:export\s+)?enum\s+(\w+)",
    r"(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=",
    r"(?:async\s+)?def\s+(\w+)",
)

_COMPILED = tuple(re.compile(p) for p in _ADDED_DEF_PATTERNS)


def shas_from_progress(progress: dict, phase: str | None = None) -> list[str]:
    """Collect commit SHAs from the progress file, optionally scoped to one phase.

    Order-preserving and de-duplicated (a phase's tasks may share a squashed SHA).
    """
    shas: list[str] = []
    for task in progress.get("tasks", []):
        if phase is not None and str(task.get("phase")) != str(phase):
            continue
        sha = task.get("commit_sha")
        if sha and sha not in shas:
            shas.append(sha)
    return shas


def added_symbols_from_shas(repo_root: Path, shas: list[str]) -> set[str]:
    """Public symbols defined on lines ADDED by the given commits.

    Private (`_`-prefixed) names are excluded — pillar (a) is about public exports
    that must have a production caller, not module-internal helpers. Returns an
    empty set if git is unavailable, the repo is invalid, or `shas` is empty.

    Thin wrapper over :func:`added_symbols_from_shas_reporting` for callers that
    do not act on the unresolved list. Prefer the reporting form in a GATE: an
    empty set here reads the same whether nothing was added or nothing could be
    read.
    """
    return added_symbols_from_shas_reporting(repo_root, shas)[0]


def added_symbols_from_shas_reporting(
    repo_root: Path, shas: list[str]
) -> tuple[set[str], list[str]]:
    """Same, plus the shas git could not resolve.

    Each sha is shown SEPARATELY. Passing them to one `git show ... check=True`
    meant a single unresolvable sha made git exit non-zero and the whole call
    return an empty set — and three of this plan's commits genuinely live in
    SIBLING repositories, which this repo cannot resolve by design. Twelve
    resolvable commits were discarded by one that was not, so `wiring_recheck`
    derived ZERO symbols for the entire slice while the checkpoint carried 16
    positive self-reports: pillar (a) was never independently confirmed for any
    symbol, and the gate reported clean for having checked nothing.

    The unresolved list is RETURNED rather than swallowed. Skipping quietly is the
    same defect one level down — a gate that drops inputs silently reports a
    better result the less it manages to read.
    """
    if not shas:
        return set(), []

    symbols: set[str] = set()
    unresolved: list[str] = []
    stdout_parts: list[str] = []
    for sha in shas:
        try:
            result = subprocess.run(
                ["git", "-C", str(repo_root), "show", "--no-color", "--unified=0",
                 "--pretty=format:", sha],
                capture_output=True, text=True, timeout=20, check=True,
            )
        except (subprocess.SubprocessError, FileNotFoundError):
            unresolved.append(sha)
            continue
        stdout_parts.append(result.stdout)

    for line in "\n".join(stdout_parts).splitlines():
        # Added content lines start with a single '+'; diff headers start with '+++'.
        if not line.startswith("+") or line.startswith("+++"):
            continue
        added = line[1:]
        for pattern in _COMPILED:
            match = pattern.search(added)
            if match:
                name = match.group(1)
                if not name.startswith("_"):
                    symbols.add(name)
    return symbols, unresolved
