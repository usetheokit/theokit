# Testing — Default Conventions (FALLBACK)

If `.claude/rules/testing.md` exists, it wins. This is fallback.

## TDD as default

- RED: write failing test FIRST.
- GREEN: minimal code to make test pass.
- REFACTOR: clean up without changing behavior.

## Coverage of critical paths

- Public API methods: 100% test coverage.
- Internal helpers: ≥ 80%.
- Error paths: tested with explicit `pytest.raises` (or equivalent).

## Bug fixes

A bug-fix task MUST include:
1. A test that REPRODUCES the bug (failing before fix).
2. The fix.
3. The same test passing after fix.

## Plan implications

- Every task with `Files to edit` listing src/ code MUST have a corresponding test file in `Files to edit`.
- Tasks marked as "bug-fix" / "regression" MUST have `#### TDD` block with RED/GREEN/REFACTOR sequence.

## How `/plan-confidence` checks testing

- `check_tdd_in_bugfix.py` validates that bug-fix tasks have explicit TDD blocks.
- Hard cap 70 if any bug-fix task lacks TDD.
