# 0026: Two pillar-map test findings the code review counts after they were fixed

- Status: Accepted
- Date: 2026-10-11
- Deciders: the repository owner, in the S-001 ship session for `pillar-map-and-import-gate` (B-416)

## Context

The `loop-code-review` audit of `pillar-map-and-import-gate` returns `BLOCKING_FINDINGS` with two
blocking ids:

- `LCR0604@tests/unit/a-pillar-proven-by-a-test-needs-a-recorded-passing-run.test.ts#L306`
  (finding #72): the 5 MB report test asserted `elapsedMs < 5000` around a spawned process, so its
  result depended on runner load.
- `LCR0602@tests/unit/a-pillar-proven-by-a-test-needs-a-recorded-passing-run.test.ts#L207`
  (finding #73): no test sent a proof path through `apps/<app>/node_modules/`, and the checker
  accepted one.

Both rows were recorded at 16:31 UTC by the run at `180adf4c`. The fixes landed at 16:56 and 16:57
UTC: `a1ddc97d` (a proof file must resolve, after links, under `apps/<app>`; new test
`fails a path that reaches a package test through the app node_modules link`) and `0a202e7f`
(the wall-clock assertion removed; the test `checks 33 rows against a 5 MB report` keeps the
5 MB read and the exit 0). The audit was then rerun at `0a202e7f` on the same database. It marked
both rows `status = fixed` and says so in its own `## Verdict`, but `count-blocking` does not filter
on `status` (the plugin's `blocking_breakdown` says this in its docstring), so the computed verdict
still counts them.

Measured at `0a202e7f` on 2026-10-11: the test file has no `elapsedMs`, `performance.now` or `5000`,
and `npx vitest run tests/unit/a-pillar-proven-by-a-test-needs-a-recorded-passing-run.test.ts -t
"through the app node_modules link|5 MB"` gives 2 passed, 24 skipped. The four plan test files give
67 passed.

## Decision

The two ids are read as fixed, by the commits above, and do not block this item's review. Any other
blocking finding of the audit, or either defect coming back, still blocks.

<!-- AUDIT-CAP-DISMISSED: loop-code-review: LCR0604@tests/unit/a-pillar-proven-by-a-test-needs-a-recorded-passing-run.test.ts#L306: fixed in 0a202e7f, the audit itself records status fixed; its count ignores status (this ADR) -->
<!-- AUDIT-CAP-DISMISSED: loop-code-review: LCR0602@tests/unit/a-pillar-proven-by-a-test-needs-a-recorded-passing-run.test.ts#L207: fixed in a1ddc97d with a test green at 0a202e7f; the audit itself records status fixed; its count ignores status (this ADR) -->

## Considered options

1. **Record the fixes and read the two ids as closed** (chosen). It uses the audit's own record of
   the fix and the tests that pin it, the same marker ADR 0024 uses for this sprint.
2. **Run the audit again on a fresh database.** Rejected for this session: the ship session was
   told not to start auditors, and a rerun costs a full audit to learn what the current one
   already records.
3. **Edit the audit database to drop the rows.** Rejected: it rewrites another tool's evidence.

## Who is affected, and what breaks

Nobody outside the repository. No code changes with this decision. If `loop-code-review` later
filters fixed rows out of its count, these two markers stop matching anything and can be removed.
