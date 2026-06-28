"""Tests for check_test_obligations — concurrency/failure test presence (GAP 6)."""
from __future__ import annotations

from pathlib import Path

from check_test_obligations import check_test_obligations, parse_obligations

PLAN_WITH_CONCURRENCY = """# Plan

### T1.1 — Shared counter

#### Concurrency tests
- Atomic-counter invariant: N writers each Add(1); assert final == N

#### Acceptance Criteria
- [ ] works
"""

PLAN_SINGLE_THREADED = """# Plan

### T1.1 — Pure refactor

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] works
"""

PLAN_WITH_FAILURES = """# Plan

## Failure scenarios (when I/O external)

| Dependency | Failure mode | How | Expected |
|---|---|---|---|
| payments-api (HTTP) | 5xx burst | mock 503 | circuit breaker opens |
"""

PLAN_NO_IO = """# Plan

## Failure scenarios (when I/O external)

(none — no external I/O touched)
"""


def test_parse_detects_real_concurrency_obligation(tmp_path: Path) -> None:
    plan = tmp_path / "p.md"
    plan.write_text(PLAN_WITH_CONCURRENCY, encoding="utf-8")
    obligations = parse_obligations(plan)
    assert any(o.kind == "concurrency" for o in obligations)


def test_parse_ignores_single_threaded_escape(tmp_path: Path) -> None:
    plan = tmp_path / "p.md"
    plan.write_text(PLAN_SINGLE_THREADED, encoding="utf-8")
    assert not any(o.kind == "concurrency" for o in parse_obligations(plan))


def test_parse_ignores_no_io_escape(tmp_path: Path) -> None:
    plan = tmp_path / "p.md"
    plan.write_text(PLAN_NO_IO, encoding="utf-8")
    assert not any(o.kind == "failure" for o in parse_obligations(plan))


def test_concurrency_obligation_without_any_test_is_high(tmp_path: Path) -> None:
    plan = tmp_path / "p.md"
    plan.write_text(PLAN_WITH_CONCURRENCY, encoding="utf-8")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_thing.py").write_text(
        "def test_adds():\n    assert 1 + 1 == 2\n", encoding="utf-8")
    report = check_test_obligations(plan, repo_root=tmp_path)
    assert "concurrency_tests_absent" in [f.code for f in report.findings]
    assert report.has_high_or_blocker is True


def test_concurrency_obligation_with_matching_test_passes(tmp_path: Path) -> None:
    plan = tmp_path / "p.md"
    plan.write_text(PLAN_WITH_CONCURRENCY, encoding="utf-8")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_race.py").write_text(
        "import threading\n\ndef test_concurrent_writers():\n"
        "    # N goroutine-like writers, atomic counter invariant\n    assert True\n",
        encoding="utf-8")
    report = check_test_obligations(plan, repo_root=tmp_path)
    assert "concurrency_tests_absent" not in [f.code for f in report.findings]


def test_failure_obligation_without_any_test_is_high(tmp_path: Path) -> None:
    plan = tmp_path / "p.md"
    plan.write_text(PLAN_WITH_FAILURES, encoding="utf-8")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_happy.py").write_text(
        "def test_ok():\n    assert True\n", encoding="utf-8")
    report = check_test_obligations(plan, repo_root=tmp_path)
    assert "failure_tests_absent" in [f.code for f in report.findings]


def test_failure_obligation_with_chaos_test_passes(tmp_path: Path) -> None:
    plan = tmp_path / "p.md"
    plan.write_text(PLAN_WITH_FAILURES, encoding="utf-8")
    (tmp_path / "tests" / "failure").mkdir(parents=True)
    (tmp_path / "tests" / "failure" / "test_5xx.py").write_text(
        "def test_circuit_breaker_opens_on_503():\n"
        "    # mock returns 503; assert breaker opens\n    assert True\n",
        encoding="utf-8")
    report = check_test_obligations(plan, repo_root=tmp_path)
    assert "failure_tests_absent" not in [f.code for f in report.findings]


def test_no_obligations_returns_skip(tmp_path: Path) -> None:
    plan = tmp_path / "p.md"
    plan.write_text(PLAN_SINGLE_THREADED, encoding="utf-8")
    report = check_test_obligations(plan, repo_root=tmp_path)
    assert report.status == "SKIP"
