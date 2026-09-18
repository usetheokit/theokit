# ADR 0005 — The root-bar gate sees values, and says so

- **Status:** Accepted (2026-09-18) — implemented as `packages/agents/tests/unit/root-bar-coverage.test.ts`
- **Date:** 2026-09-18
- **Deciders:** recorded retroactively; see § Provenance
- **Closes:** five dangling `ADR 0061` citations across three files

## Context

`subpath-coverage.test.ts` demands an explicit `in`/`out` verdict with a written reason for each of
`@theokit/sdk`'s subpaths, and its header states why a verdict beats an allowlist: without one,
*"nobody has decided yet"* is indistinguishable from *"we decided it stays out"*. Measured
2026-09-18: 34 subpaths declared by `@theokit/sdk@5.9.0`, 34 enumerated by the test, none missing.

That policy covered the subpath axis and not the SDK's **root bar** (`@theokit/sdk` entry `.`), which
no gate enumerated. The measured consequence is in the test's own header: **nine consecutive minors
(4.41 → 4.49) added symbols there and not one produced a signal.** The omission did not survive
because reviewers were careless — it survived because the instrument's scope was narrower than the
property it claimed.

## Decision

Enumerate the root bar with `Object.keys` over the **imported ESM namespace**, compare by referential
identity, and **name the test for what it checks**. Type-only exports are outside what this instrument
can see, and that gap is declared rather than papered over.

## Alternatives rejected

1. **Enumerate the SDK through `createRequire`.** Rejected on measurement: every symbol read as NOT
   crossing. CJS and ESM are different module instances, so referential identity is false by
   construction between them. The comparison is only meaningful when both sides come from the same
   module graph — which is also the graph a consumer loads.
2. **Claim "every root-bar export has a verdict" while covering only values.** Rejected because it
   repeats, one level down, the exact defect this gate exists to close: an instrument whose scope is
   narrower than the property it claims. A test that overstates its reach is worse than an absent one,
   because the overstatement is what a reader checks.
3. **Extend the gate to types in the same change.** Rejected as scope: the oracle for types is `tsc`
   over the declared `types` entry, not a runtime enumeration, and building it is a different piece of
   work. It is declared a known gap here instead of being silently absent.

## The size of the declared gap

The cross-validation audit of 2026-09-17 puts the unseen share at **324 of 422 root-bar exports** —
roughly three quarters. **That number is the audit's**, is written nowhere else in this repository, and
was not re-measured when this ADR was written. It is recorded because a gap declared without its size
reads as small, and this one is not.

Closing it is tracked as `B-178`.

## Provenance — why this ADR is numbered 0005 and not 0061

**`ADR 0061` was cited five times across three files** — twice in `root-bar-coverage.test.ts`
(including for "alternative 4"), twice in `packages/agents/src/index.ts`, once in
`packages/agents/tests/type/trust-posture-passthrough.test-d.ts`. Measured 2026-09-18: no file matching
`*0061*` exists in this repository or in any sibling of the ecosystem, and `docs/adr/` held exactly
four ADRs, `0001`–`0004`. Every one of the five resolved to nothing.

The cross-validation audit that prompted this work did not flag any of them, and its own remediation
plan prescribed *"put the 324/422 number into ADR 0061"* — editing a document that does not exist. An
audit inherits the citations of the code it reads unless it checks them.

A citation that resolves to nothing reads as evidence and is not — the failure this project's own
`plan-confidence` hard-caps a plan for. So the decision is recorded here, at the next free number, and
the two citations in the test now point at a document that exists.

**The alternatives above are reconstructed from the test's own header, not recovered from a prior
document.** The header names two rejected approaches with their measurements; the third is stated as
the scope decision it was. Whatever "alternative 4" referred to could not be recovered, and inventing
it would be the fabrication this ADR exists to remove.
