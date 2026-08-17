"""Tests for check_failure_scenarios (SOTA upgrade Phase 2)."""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest


from check_failure_scenarios import check_failure_scenarios  # noqa: E402


def _write(content: str) -> Path:
    p = Path(tempfile.mktemp(suffix="-plan.md"))
    p.write_text(content)
    return p


def test_pure_logic_plan_skipped():
    """A plan that touches no external I/O passes with the check skipped."""
    content = """# Plan
## Goal
refactor pure function
## Baseline Context
### Files that will be touched
| File | LoC today | Last commit | Why | Invariants |
|---|---|---|---|---|
| src/lib/util.py | 50 | f7a91be (2026-06-01) | math helpers | type-stable |
## Phase 1
### T1.1 — rename
"""
    p = _write(content)
    r = check_failure_scenarios(p)
    assert r.external_io_detected is False
    assert r.is_complete is True
    p.unlink()


def test_http_signal_without_section_fails():
    content = """# Plan
## Goal
add webhook
## Baseline Context
### Files that will be touched
| File | LoC today | Last commit | Why | Invariants |
|---|---|---|---|---|
| src/webhook.py | 50 | f7a91be (2026-06-01) | calls payments-api via httpx | error path |

Uses httpx.AsyncClient.

## Phase 1
### T1.1 — call payments
"""
    p = _write(content)
    r = check_failure_scenarios(p)
    assert r.external_io_detected is True
    assert r.section_present is False
    assert r.is_complete is False
    assert any("missing" in reason for reason in r.reasons)
    p.unlink()


def test_db_signal_with_populated_section_passes():
    content = """# Plan
## Goal
persist orders
## Baseline Context
### Files that will be touched
| File | LoC today | Last commit | Why | Invariants |
|---|---|---|---|---|
| src/repo/orders.py | 80 | f7a91be (2026-06-01) | sqlalchemy session | rollback on error |

## Phase 1
### T1.1 — persist
#### TDD
RED: test_save()

## Failure scenarios

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| postgres:orders | connection reset mid-tx | testcontainers + pg_terminate_backend | retry once; rollback on second |
"""
    p = _write(content)
    r = check_failure_scenarios(p)
    assert r.external_io_detected is True
    assert r.section_present is True
    assert r.scenarios_count >= 1
    assert r.is_complete is True
    p.unlink()


def test_explicit_none_escape_is_honored():
    """A plan whose code uses third-party API name but doesn't actually call it can declare so."""
    content = """# Plan
## Goal
documentation update
## Baseline Context
### Files that will be touched
| File | LoC today | Last commit | Why | Invariants |
|---|---|---|---|---|
| docs/external-api.md | 100 | f7a91be (2026-06-01) | mentions external API in prose | none |

The doc describes the external API surface but the plan only edits docs.

## Failure scenarios

(none — no external I/O touched)

## Phase 1
### T1.1 — update doc
"""
    p = _write(content)
    r = check_failure_scenarios(p)
    assert r.external_io_detected is True
    assert r.explicit_none is True
    assert r.is_complete is True
    p.unlink()


def test_section_present_but_empty_fails():
    content = """# Plan
## Goal
call api
## Baseline Context
Uses requests.get('https://api.example.com') to call payments-api.

## Phase 1
### T1.1 — call
#### TDD
RED: test_call()

## Failure scenarios

(section title with no rows or bullets)
"""
    p = _write(content)
    r = check_failure_scenarios(p)
    assert r.external_io_detected is True
    assert r.section_present is True
    assert r.scenarios_count == 0
    assert r.is_complete is False
    p.unlink()


def test_queue_and_grpc_signals_detected():
    content = """# Plan
## Goal
publish events
## Baseline Context
### Files that will be touched
| File | LoC today | Last commit | Why | Invariants |
|---|---|---|---|---|
| src/events/publisher.py | 60 | f7a91be (2026-06-01) | Kafka producer | exactly-once |

Uses Kafka and gRPC.

## Phase 1
### T1.1 — publish
"""
    p = _write(content)
    r = check_failure_scenarios(p)
    assert r.external_io_detected is True
    assert r.is_complete is False  # no Failure scenarios section
    sig_lower = " ".join(r.signals_sample).lower()
    assert "kafka" in sig_lower or "grpc" in sig_lower
    p.unlink()


def test_fenced_code_does_not_create_false_positive():
    """The string `requests.get(` inside fenced code is example documentation, not a signal."""
    content = """# Plan
## Goal
refactor pure parser
## Baseline Context
### Files that will be touched
| File | LoC today | Last commit | Why | Invariants |
|---|---|---|---|---|
| src/parser.py | 100 | f7a91be (2026-06-01) | pure parsing | type-stable |

Example of what we are NOT doing (this code is from elsewhere, for reference):
```
import requests
data = requests.get('https://api.example.com').json()
```

The new parser does no network calls.

## Phase 1
### T1.1 — refactor
"""
    p = _write(content)
    r = check_failure_scenarios(p)
    assert r.external_io_detected is False
    assert r.is_complete is True
    p.unlink()


def test_bulleted_scenarios_also_count():
    content = """# Plan
## Goal
fetch
## Baseline Context
Uses httpx.

## Phase 1
### T1.1 — fetch

## Failure scenarios

- payments-api timeout 30s: mock with httpx_mock returning delayed; retry once; surface error after
- payments-api 5xx burst: mock returning 503 three times; circuit breaker opens; metric increments
"""
    p = _write(content)
    r = check_failure_scenarios(p)
    assert r.external_io_detected is True
    assert r.section_present is True
    assert r.scenarios_count >= 2
    assert r.is_complete is True
    p.unlink()
