# 0029: Three live-model findings the code review counts after they were fixed

- Status: Accepted
- Date: 2026-10-11
- Deciders: the repository owner, in the S-001 ship session for `ci-live-model-job` (B-415)

## Context

The `loop-code-review` audit of `ci-live-model-job` returns `BLOCKING_FINDINGS` with three blocking
ids:

- `LCR2004@.github/workflows/live-model.yml#L31` (finding #67): the key-bearing job ran
  `usetheokit/shared-workflows/actions/setup@v1`, a tag anyone with push access can move.
- `CWE-532@scripts/redact-provider-keys.mjs#L36` (finding #77): `redact()` matched runs of the key
  case-sensitively, so an upper-cased fragment of the key passed through unredacted.
- `LCR0602@tests/unit/the-live-suite-output-carries-no-key-shape.test.ts#L36` (finding #79): no test
  pinned the case-sensitive match.

`ffdcfea4` compares each slice of the key lower-cased and adds two regression tests (#77, #79).
`677cbda4` pins the setup action to commit `95ef5a1e` and adds a test refusing any unpinned action in
the job (#67). The audit was rerun with `audited_head` `677cbda4` on the same database. Its report
marks all three as fixed, but `count-blocking` does not filter on `status`, so the computed verdict
still counts them. ADRs 0026, 0027 and 0028 record the same behaviour for other S-001 items.

Measured at `677cbda4` on 2026-10-11:

- The three files above are byte-identical between `677cbda4` and `c085b99f`, the rebuilt head the
  audit scoped (`git diff --stat c085b99f HEAD` on them prints nothing).
- `npx vitest run` on `the-live-suite-output-carries-no-key-shape.test.ts`,
  `the-live-model-preflight-names-why-it-could-not-run.test.ts` and
  `the-live-model-workflow-runs-on-develop.test.ts`: 3 files, 70 passed. Filtered to the three new
  tests (`redacts a run of the configured key whatever its letter case`,
  `redacts an upper-cased run of the configured key that carries no prefix`,
  `pins every action the key-bearing job uses to a 40-character commit`): 3 passed.

## Decision

The three ids are read as fixed by `ffdcfea4` and `677cbda4` and do not block this item's review. Any
other blocking finding of the audit, the job going back to a tag, or `redact()` going back to a
case-sensitive match still blocks. The open medium and low findings of the same audit are not
blocking and are not dismissed here.

<!-- AUDIT-CAP-DISMISSED: loop-code-review: LCR2004@.github/workflows/live-model.yml#L31: fixed in 677cbda4, pinned-action test green at 677cbda4; the audit itself records status fixed; its count ignores status (this ADR) -->
<!-- AUDIT-CAP-DISMISSED: loop-code-review: CWE-532@scripts/redact-provider-keys.mjs#L36: fixed in ffdcfea4, letter-case redaction tests green at 677cbda4; the audit itself records status fixed; its count ignores status (this ADR) -->
<!-- AUDIT-CAP-DISMISSED: loop-code-review: LCR0602@tests/unit/the-live-suite-output-carries-no-key-shape.test.ts#L36: fixed in ffdcfea4, the two regression tests it asked for are green at 677cbda4; the audit itself records status fixed; its count ignores status (this ADR) -->

## Considered options

1. **Record the fix and read the three ids as closed** (chosen). It uses the audit's own record of the
   fix and the tests that pin it, with the marker ADRs 0026 to 0028 use.
2. **Run the audit again on a fresh database.** Rejected for this session: the ship session was told
   not to start auditors, and the rerun that already happened records the fix.
3. **Edit the audit database to drop the rows.** Rejected: it rewrites another tool's evidence.

## Who is affected, and what breaks

Nobody outside the repository. No code changes with this decision. If `loop-code-review` later
filters fixed rows out of its count, these three markers stop matching anything and can be removed.
