# 0027: Three parity-ledger findings the code review counts after they were fixed

- Status: Accepted
- Date: 2026-10-11
- Deciders: the repository owner, in the S-001 ship session for `theoclaw-parity-ledger` (B-404)

## Context

The `loop-code-review` audit of `theoclaw-parity-ledger` at `38fa5d93` returns `BLOCKING_FINDINGS`
with three blocking ids:

- `LCR0202@apps/theoclaw/tools/check-parity-ledger.mjs#L132` (finding #65): a shipped row was
  proven by any quoted occurrence of its test name in any regular file of the repository, including
  `it.skip`, `it.todo`, a comment, a constant or the ledger itself.
- `LCR2002@apps/theoclaw/package.json#L19` (finding #67): no CI job ran static analysis over
  `apps/theoclaw/tools/*.mjs`.
- `LCR0602@apps/theoclaw/tools/check-parity-ledger.test.mjs#L237` (finding #71): no test covered the
  carriers of #65.

The rows were recorded by the run at `cfaf888f`. `47cb1903` fixed #65 and #71: the check path must
be a file theoclaw's vitest collects (else `check-not-a-test`), and the title must be the first
argument of a runnable `it(` or `test(` call outside comments and not-run calls. `38fa5d93` fixed
#67 with `apps/theoclaw/eslint.config.mjs`, a `lint` script and a `pnpm --filter theoclaw run lint`
step in the theoclaw CI job. The audit was rerun at `38fa5d93` on the same database. It set all three
rows to `status = fixed` and says so in its own `## Verdict`, but `count-blocking` does not filter on
`status`, so the computed verdict still counts them. ADR 0026 records the same behaviour for B-416.

Measured at `38fa5d93` on 2026-10-11:

- `npx vitest run tools/check-parity-ledger.test.mjs` in `apps/theoclaw`: 48 passed.
- The two regression tests from `47cb1903`, `refuses a named title that only a skipped test, a todo,
  a comment or a constant carries` and `refuses a shipped check path that is not a test file
  theoclaw runs`: 2 passed, 46 skipped.
- `pnpm --filter theoclaw run lint`: exit 0. With a probe file `tools/zz-lint-probe.mjs` holding an
  unused variable it exits 1 with `no-unused-vars`, so the step fails on a violation. The probe was
  deleted.

## Decision

The three ids are read as fixed, by the commits above, and do not block this item's review. Any
other blocking finding of the audit, or any of these defects coming back, still blocks. The open
medium findings of the same audit (#74, #77, #79: the tokenizer can be misled by a regex literal or
by astral characters) are not blocking and are not dismissed here.

<!-- AUDIT-CAP-DISMISSED: loop-code-review: LCR0202@apps/theoclaw/tools/check-parity-ledger.mjs#L132: fixed in 47cb1903 with a test green at 38fa5d93; the audit itself records status fixed; its count ignores status (this ADR) -->
<!-- AUDIT-CAP-DISMISSED: loop-code-review: LCR2002@apps/theoclaw/package.json#L19: fixed in 38fa5d93, lint step exits 1 on a violating probe; the audit itself records status fixed; its count ignores status (this ADR) -->
<!-- AUDIT-CAP-DISMISSED: loop-code-review: LCR0602@apps/theoclaw/tools/check-parity-ledger.test.mjs#L237: fixed in 47cb1903, test green at 38fa5d93; the audit itself records status fixed; its count ignores status (this ADR) -->

## Considered options

1. **Record the fixes and read the three ids as closed** (chosen). It uses the audit's own record of
   the fix and the tests and lint step that pin it, with the marker ADRs 0024 and 0026 use.
2. **Run the audit again on a fresh database.** Rejected for this session: the ship session was told
   not to start auditors, and a rerun costs a full audit to learn what the current one records.
3. **Edit the audit database to drop the rows.** Rejected: it rewrites another tool's evidence.

## Who is affected, and what breaks

Nobody outside the repository. No code changes with this decision. If `loop-code-review` later
filters fixed rows out of its count, these three markers stop matching anything and can be removed.
