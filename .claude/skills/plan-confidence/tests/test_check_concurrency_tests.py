"""Tests for check_concurrency_tests (SOTA upgrade Phase 2)."""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest


from check_concurrency_tests import check_concurrency_tests  # noqa: E402


def _write(content: str) -> Path:
    p = Path(tempfile.mktemp(suffix="-plan.md"))
    p.write_text(content)
    return p


def test_plan_without_concurrency_signals_is_skipped():
    """A pure UI/CRUD plan with no concurrency signals must pass with is_complete=True."""
    content = """# Plan: UI
## Goal
Add tooltip
## Baseline Context
### Files that will be touched
| File | LoC today | Last commit | Why | Invariants |
|---|---|---|---|---|
| src/ui/button.tsx | 50 | f7a91be (2026-06-01) | render | layout stable |
## Phase 1
### T1.1 — add tooltip
#### TDD
RED: test_tooltip_renders()
"""
    p = _write(content)
    r = check_concurrency_tests(p)
    assert r.signals_detected is False
    assert r.is_complete is True
    assert r.tasks_failing == ()
    p.unlink()


def test_goroutine_signal_triggers_check():
    content = """# Plan: cache
## Goal
add cache
## Baseline Context
### Files that will be touched
| File | LoC today | Last commit | Why | Invariants |
|---|---|---|---|---|
| src/cache.go | 80 | f7a91be (2026-06-01) | sync.Mutex map | exclusion holds |

The cache spawns goroutines to evict stale entries.

## Phase 1
### T1.1 — implement cache
#### TDD
RED: test_put_get()
"""
    p = _write(content)
    r = check_concurrency_tests(p)
    assert r.signals_detected is True
    assert any("sync.Mutex" in s or "goroutine" in s for s in r.signals_sample)
    assert r.tasks_failing == ("T1.1",)
    assert r.is_complete is False
    p.unlink()


def test_concurrency_subsection_with_race_signal_passes():
    content = """# Plan: cache
## Goal
add cache
## Baseline Context
### Files that will be touched
| File | LoC today | Last commit | Why | Invariants |
|---|---|---|---|---|
| src/cache.go | 80 | f7a91be (2026-06-01) | goroutine-driven | exclusion holds |

## Phase 1
### T1.1 — implement cache
#### TDD
RED: test_put_get()
GREEN: implement

#### Concurrency tests
- go test -race ./cache/... — race detector run on the goroutine path
- atomic-counter invariant: 100 goroutines each Put; final size == 100
"""
    p = _write(content)
    r = check_concurrency_tests(p)
    assert r.signals_detected is True
    assert r.is_complete is True
    assert r.tasks_with_acceptable_test_or_escape == 1
    p.unlink()


def test_concurrency_subsection_with_escape_marker_passes():
    """A task that documents it is genuinely single-threaded escapes the cap."""
    content = """# Plan: mixed
## Goal
async pipeline + a pure helper
## Baseline Context
### Files that will be touched
| File | LoC today | Last commit | Why | Invariants |
|---|---|---|---|---|
| src/pipeline.py | 120 | f7a91be (2026-06-01) | asyncio orchestrator | order stable |

Uses asyncio.gather and async def.

## Phase 1
### T1.1 — pure helper rename
#### TDD
RED: test_rename()

#### Concurrency tests
(none — single-threaded)
"""
    p = _write(content)
    r = check_concurrency_tests(p)
    assert r.signals_detected is True
    # T1.1 escapes via the explicit marker
    assert r.is_complete is True
    assert r.tasks_with_acceptable_test_or_escape == 1
    p.unlink()


def test_subsection_present_but_no_race_signal_fails():
    content = """# Plan
## Goal
x
## Baseline Context
Uses mutex and goroutines.
## Phase 1
### T1.1 — task
#### TDD
RED: test_x()

#### Concurrency tests
We will write tests later.
"""
    p = _write(content)
    r = check_concurrency_tests(p)
    assert r.signals_detected is True
    assert r.tasks_failing == ("T1.1",)
    assert any("acceptable race-aware signal" in reason for reason in r.reasons)
    p.unlink()


def test_fenced_code_does_not_create_false_positive():
    """The word `mutex` inside a fenced code block should not trigger the check.

    Plans frequently quote code samples or reference snippets; signals must come
    from prose, not from documentation code blocks.
    """
    content = """# Plan: parser refactor
## Goal
x
## Baseline Context
### Files that will be touched
| File | LoC today | Last commit | Why | Invariants |
|---|---|---|---|---|
| src/parser.py | 100 | f7a91be (2026-06-01) | pure parsing | none |

Example of what NOT to do (code block):
```
sync.Mutex used in old code; this plan removes it.
```

The new parser is pure-functional.

## Phase 1
### T1.1 — refactor
#### TDD
RED: test_pure()
"""
    p = _write(content)
    r = check_concurrency_tests(p)
    # Signals are in fenced code → stripped, so no detection
    assert r.signals_detected is False
    assert r.is_complete is True
    p.unlink()


def test_multiple_tasks_partial_pass_fails_overall():
    content = """# Plan: concurrent
## Goal
x
## Baseline Context
Uses goroutines and sync.WaitGroup.

## Phase 1
### T1.1 — good task
#### TDD
RED: test_a()

#### Concurrency tests
- go test -race ./pkg/... — race detector

### T1.2 — task without subsection
#### TDD
RED: test_b()
"""
    p = _write(content)
    r = check_concurrency_tests(p)
    assert r.signals_detected is True
    assert r.is_complete is False
    assert r.tasks_failing == ("T1.2",)
    assert r.tasks_with_acceptable_test_or_escape == 1
    p.unlink()
