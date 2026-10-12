# 0030: A max-cost finding whose fix sits outside the audited range

- Status: Accepted
- Date: 2026-10-11
- Deciders: the repository owner, in the S-001 ship session for `agents-max-cost-usd` (B-409)

## Context

The `loop-code-review` audit of `agents-max-cost-usd` returns `BLOCKING_FINDINGS` with one blocking id,
`LCR0202@packages/agents/src/bridge/sdk-adapter-create-options.ts#L692` (finding #78). In the tree it
reviewed, the SDK adapter built `done.cost` from `result.cost?.amount`, a field the SDK's
`CostBreakdown` does not have. Every SDK-backed round then reported a known cost of 0, so the USD
ceiling, the unpriced refusal and `costUnknown` could not act on the real SDK path. The audit ran the
integration test `a-cost-ceiling-trips-on-the-cost-the-sdk-priced.test.ts` on that tree and it failed
3 of 3.

The audit scoped this item's own commits (`bcddf164..33d7004f`, a rebuilt head). The fix belongs to
another item of the same sprint, `agents-done-event-cost` (B-419, #969): `c7707cca` reads `amountUsd`
in the adapter and `1f95c726` does the same in `translateSdkEvent`. The audit's report says so and
names its remedy: ship this change only together with those two commits, and run the integration test
against a tree that holds all three.

Measured at `bb1bd0ec` on 2026-10-11:

- `c7707cca` and `1f95c726` are ancestors of `HEAD` (`git merge-base --is-ancestor`).
- `npx vitest run tests/integration/a-cost-ceiling-trips-on-the-cost-the-sdk-priced.test.ts` in
  `packages/agents`: 1 file, 3 passed.
- Both changes ship in the same release. S-001 releases as one milestone (M17), and the changeset
  `a-run-reports-the-cost-the-sdk-priced.md` (#969) sits beside
  `max-cost-usd-stops-a-run-before-it-overspends.md`, which already names #969 as the source of the
  cost the ceiling reads.

## Decision

The id is read as fixed by `c7707cca` and `1f95c726` and does not block this item's review. If the
release is ever split so that this change ships without #969, the finding is back in force. Any other
blocking finding of the audit still blocks. Its open medium and low findings are not blocking and are
not dismissed here.

<!-- AUDIT-CAP-DISMISSED: loop-code-review: LCR0202@packages/agents/src/bridge/sdk-adapter-create-options.ts#L692: fixed in c7707cca and 1f95c726 (B-419, #969), both ancestors of HEAD; a-cost-ceiling-trips-on-the-cost-the-sdk-priced.test.ts 3 passed at bb1bd0ec; both ship in M17 (this ADR) -->

## Considered options

1. **Record the fix and read the id as closed** (chosen). It does what the audit's remediation asks:
   the three commits are in one tree, they ship together, and the test the audit ran is green there.
   ADRs 0026 to 0029 use the same marker.
2. **Run the audit again over a range that includes `c7707cca`.** Rejected for this session: the ship
   session was told not to start auditors, and a range wide enough to hold another item's commits is
   what the item scope exists to narrow.
3. **Edit the audit database to drop the row.** Rejected: it rewrites another tool's evidence.

## Who is affected, and what breaks

Nobody outside the repository. No code changes with this decision. A release that carried B-409's
changeset without B-419's would ship a ceiling that never trips; the M17 release carries both.
