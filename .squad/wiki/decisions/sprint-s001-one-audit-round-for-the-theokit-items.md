# Sprint S-001 audits the theokit items in one round

- Status: Accepted
- Date: 2026-10-06
- Deciders: Paulo (project owner)
- Items: B-404, B-407, B-408, B-409, B-411, B-415, B-416, B-419 (milestone M17)

## Context

Each REVIEW requires the independent `loop-*` auditors its domains select. Across the eight
theokit items of S-001 the selection is the union of six plugins: `loop-code-review`,
`loop-security-audit`, `loop-test-audit`, `loop-infra-audit`, `loop-surface-closure` and
`loop-performance-audit`.

The items were built in parallel on one `workspace` branch, so their commits interleave: 50
commits sit between `origin/develop` and `HEAD`. Measured on B-420, one auditor costs between
US$ 25 and US$ 46 per run. One round per item would cost roughly US$ 1,200 to 1,600 and run
serially, because only one auditor may run per directory at a time.

## Decision

Run each of the six auditors once, scoped to `--diff-base origin/develop`, and give every item
the same reports. Each item still gets its own auditor selection, written before its reports are
placed, its own reviewers and its own consolidated verdict.

## Considered options

1. **One round for all eight items** (chosen). About US$ 200 to 300.
2. **One round per item.** The kit's default. Rejected on cost and time: the per-item scope would
   still be a commit range that mixes items (squad#605), so the isolation it buys is partial.
3. **One round per package** (four rounds). Rejected: it costs about two to three times option 1
   and still mixes items inside each package.

## Consequences

- A blocking finding in one item's code appears in every item's review. That coupling is accepted
  because the sprint ships as one release (M17): no item can reach `main` before the others anyway.
  The reviewer of each item attributes such a finding to the item that owns the file.
- An auditor that a single item would not have required (for example `loop-infra-audit` on the CI
  item) still reads that item's change. That widens coverage and never narrows it.
- Revisit when squad#605 gives a per-item scope on a shared branch, or when items stop sharing a
  release.

## Addendum 2026-10-09: four reviewer roles per item

Paulo asked for the most efficient path. Each theokit item of S-001 gets the four general `/review`
roles (architecture, tests, wiring, cross-validation) and none of the domain roles. The domains are
already covered by the independent `loop-*` audits of this one round, which ran on the same range.
B-420 had all seven roles before this addendum and keeps their findings.
