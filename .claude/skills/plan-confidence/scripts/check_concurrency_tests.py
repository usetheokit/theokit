"""Conditional concurrency-tests check for /to-plan plans (SOTA upgrade Phase 2).

Bugs in concurrent code escape TDD-first because single-threaded test execution
interleaves cleanly — the race manifests only under specific schedules. A plan
that touches shared mutable state SHOULD declare a concurrency-aware test
(race detector, atomic-counter invariant, happens-before observation,
cancellation/timeout assertion).

This checker is CONDITIONAL: it only enforces the rule when the plan contains
concurrency signals. Plans whose Baseline Context + Deep Dives + Files-to-edit
sections are signal-free are unaffected.

Soft cap stable id: `soft_floor_concurrency_tests_missing` (cap 89; sunset
2026-09-07 — after which promotes to hard cap 70 via ADR).

Detection rule:

  1. Scan a stable set of sections — Baseline Context, Prior Art & Related Work,
     ADRs, Phase prose (Objective + Why this step + Evidence + Deep Dives +
     Files to edit), Failure scenarios.
  2. Look for concurrency signals: language-agnostic tokens (mutex/lock/atomic/
     concurrent/race/thread/goroutine/channel/async/await/Promise.all/sync.X)
     and language-specific imports (`from threading`, `import asyncio`, `sync.Mutex`,
     `tokio::`, `Atomics`, `worker_threads`).
  3. If signals found in step 2, examine every task's `#### Concurrency tests`
     subsection. The task passes if the subsection contains either:
       - the literal escape `(none — single-threaded)` (with `--` or `—`), OR
       - at least one acceptable race-aware test signal (race/loom/concurrent/
         goroutine test/parallel test/JCStress/Atomics/--race/atomic counter).

  4. Tasks that lack a `#### Concurrency tests` subsection at all, in a plan
     that has signals, fail the check.

Fenced code blocks are masked before scanning so example documentation does not
pollute signal counts.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

FENCED_CODE_RE = re.compile(r"^(```|~~~)[^\n]*\n.*?^\1", re.MULTILINE | re.DOTALL)

# Section title patterns whose contents are inspected for concurrency signals.
# Per task, the body of `#### Concurrency tests` is examined for the escape OR
# acceptable race-aware signals.
SCAN_HEADINGS = (
    "Baseline Context",
    "Prior Art & Related Work",
    "ADRs",
    "Drawbacks & Risks",
    "Failure scenarios",
)

# Language-agnostic concurrency tokens — case-insensitive word-boundary match.
# Curated to be specific enough that a plan about UI layout will not false-positive,
# but broad enough to catch the patterns that actually matter.
CONCURRENCY_SIGNALS = (
    # generic
    r"\bmutex\b",
    r"\bsemaphore\b",
    r"\brace condition\b",
    r"\brace[- ]detector\b",
    r"\bthread[- ]safe\b",
    r"\batomic(?:\s+counter|\s+operation|\b)",
    r"\bconcurrenc(?:y|e)\b",
    r"\block-free\b",
    r"\bnon-blocking\b",
    r"\bhappens-before\b",
    # Python
    r"\bthreading\.",
    r"\basyncio\b",
    r"\basync\s+def\b",
    r"\bawait\s+",
    r"\bmultiprocessing\b",
    r"\bconcurrent\.futures\b",
    r"\bSemaphore\(",
    # Go
    r"\bgoroutine\b",
    r"\bsync\.(?:Mutex|RWMutex|WaitGroup|Once)\b",
    r"\bchan\s+",
    r"\bgo\s+func\s*\(",
    # Rust
    r"\bMutex(?:<|::new)",
    r"\bRwLock<",
    r"\bArc<",
    r"\btokio::",
    r"\basync\s+fn\b",
    r"\bspawn\(",
    # Java / Kotlin
    r"\bsynchronized\s*\(",
    r"\bConcurrentHashMap\b",
    r"\bAtomicInteger\b",
    r"\bAtomicLong\b",
    r"\bAtomicReference\b",
    r"\bCountDownLatch\b",
    r"\bReentrantLock\b",
    r"\bvolatile\s+\w",
    # JS / TS
    r"\bPromise\.all\(",
    r"\bworker_threads\b",
    r"\bAtomics\.",
    r"\bSharedArrayBuffer\b",
)

# Acceptable race-aware test signals — these are what the task's
# `#### Concurrency tests` subsection MUST contain to pass.
RACE_TEST_SIGNALS = (
    r"\bgo test -race\b",
    r"\b--race\b",
    r"\bloom::",
    r"\bloom\s+test\b",
    r"\bpytest-asyncio\b",
    r"\bJCStress\b",
    r"\bAtomics\.\w+",
    r"\brace\s+detector\b",
    r"\bconcurrent\s+test\b",
    r"\bparallel\s+test\b",
    r"\bgoroutine\s+test\b",
    r"\batomic[- ]counter\s+invariant\b",
    r"\bhappens-before\s+observation\b",
    r"\bcancellation\s+propagat",
)

ESCAPE_MARKERS = (
    r"\(none\s*[—\-–]+\s*single[- ]threaded\)",
)

CONCURRENCY_SIGNALS_RE = re.compile("|".join(CONCURRENCY_SIGNALS), re.IGNORECASE)
RACE_TEST_SIGNALS_RE = re.compile("|".join(RACE_TEST_SIGNALS), re.IGNORECASE)
ESCAPE_RE = re.compile("|".join(ESCAPE_MARKERS), re.IGNORECASE)

H2_RE = re.compile(r"^##\s+(.*?)\s*$", re.MULTILINE)
H4_TASK_RE = re.compile(r"^###\s+(T\d+\.\d+)\b[^\n]*$", re.MULTILINE)
H4_CONCURRENCY_RE = re.compile(
    r"^####\s+Concurrency tests\b[^\n]*$", re.MULTILINE
)


@dataclass(frozen=True)
class ConcurrencyReport:
    """Structural report for concurrency-test enforcement."""

    signals_detected: bool
    signals_sample: tuple[str, ...] = field(default_factory=tuple)
    tasks_with_concurrency_subsection: int = 0
    tasks_with_acceptable_test_or_escape: int = 0
    tasks_failing: tuple[str, ...] = field(default_factory=tuple)
    is_complete: bool = True
    reasons: tuple[str, ...] = field(default_factory=tuple)


def _strip_code(content: str) -> str:
    def blank(m: re.Match[str]) -> str:
        return re.sub(r"[^\n]", " ", m.group(0))

    return FENCED_CODE_RE.sub(blank, content)


def _extract_section(content: str, heading: str) -> str | None:
    """Match `## {heading}` (optionally followed by trailing text) up to next H2."""
    pattern = re.compile(rf"^##\s+{re.escape(heading)}(?=\b|$)", re.MULTILINE)
    m = pattern.search(content)
    if m is None:
        return None
    start = m.end()
    next_h2 = re.search(r"^##\s+", content[start:], re.MULTILINE)
    end = (start + next_h2.start()) if next_h2 else len(content)
    return content[start:end]


def _scan_for_signals(content: str) -> list[str]:
    """Return the unique concurrency-signal raw matches in content."""
    seen: list[str] = []
    seen_norm: set[str] = set()
    for m in CONCURRENCY_SIGNALS_RE.finditer(content):
        raw = m.group(0)
        norm = raw.lower().strip()
        if norm in seen_norm:
            continue
        seen_norm.add(norm)
        seen.append(raw)
    return seen


def _iter_task_blocks(content: str) -> list[tuple[str, str]]:
    """Return list of (task_id, task_body) for every `### T<N>.<M>` block."""
    matches = list(H4_TASK_RE.finditer(content))
    tasks: list[tuple[str, str]] = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        # Cut at next H2 or H3 of a different kind (e.g., "## Phase")
        next_h2 = re.search(r"^##\s+", content[start:end], re.MULTILINE)
        if next_h2:
            end = start + next_h2.start()
        tasks.append((m.group(1), content[start:end]))
    return tasks


def _extract_concurrency_subsection(task_body: str) -> str | None:
    """Return text after `#### Concurrency tests` up to next `####` or end."""
    m = H4_CONCURRENCY_RE.search(task_body)
    if m is None:
        return None
    start = m.end()
    next_h4 = re.search(r"^####\s+", task_body[start:], re.MULTILINE)
    end = (start + next_h4.start()) if next_h4 else len(task_body)
    return task_body[start:end]


def check_concurrency_tests(plan_path: Path) -> ConcurrencyReport:
    """Inspect plan_path and produce a ConcurrencyReport.

    No-signals-found is a PASS (is_complete=True, signals_detected=False).
    Signals-found + at least one task without an acceptable test/escape is FAIL.
    """
    content = plan_path.read_text(encoding="utf-8-sig")
    stripped = _strip_code(content)

    # Step 1 — collect the scanning corpus from the SCAN_HEADINGS plus the body of
    # every task block (Phase prose). Concurrency signals appearing in task prose
    # are also enforcement triggers — a task that uses goroutines in its Deep Dives
    # but ships zero race tests is a defect.
    corpus_parts: list[str] = []
    for heading in SCAN_HEADINGS:
        sec = _extract_section(stripped, heading)
        if sec is not None:
            corpus_parts.append(sec)
    for _, body in _iter_task_blocks(stripped):
        corpus_parts.append(body)
    corpus = "\n".join(corpus_parts)

    signals = _scan_for_signals(corpus)
    if not signals:
        return ConcurrencyReport(
            signals_detected=False,
            is_complete=True,
            reasons=("no concurrency signals detected; check skipped",),
        )

    # Step 2 — at least one signal present; enforce per-task contract.
    tasks_with_subsection = 0
    tasks_passing = 0
    failing: list[str] = []
    reasons: list[str] = []
    for task_id, body in _iter_task_blocks(stripped):
        sub = _extract_concurrency_subsection(body)
        if sub is None:
            failing.append(task_id)
            reasons.append(
                f"{task_id} lacks a `#### Concurrency tests` subsection; "
                "plan declares concurrency signals so every task must declare its concurrency posture"
            )
            continue
        tasks_with_subsection += 1
        if ESCAPE_RE.search(sub) or RACE_TEST_SIGNALS_RE.search(sub):
            tasks_passing += 1
        else:
            failing.append(task_id)
            reasons.append(
                f"{task_id} `#### Concurrency tests` does not contain an acceptable "
                "race-aware signal (race/loom/concurrent/parallel/atomic-counter/cancellation) "
                "nor the explicit '(none — single-threaded)' escape"
            )

    return ConcurrencyReport(
        signals_detected=True,
        signals_sample=tuple(signals[:5]),
        tasks_with_concurrency_subsection=tasks_with_subsection,
        tasks_with_acceptable_test_or_escape=tasks_passing,
        tasks_failing=tuple(failing),
        is_complete=len(failing) == 0,
        reasons=tuple(reasons),
    )
