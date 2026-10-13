# Proceed past the knip soft cap for B-420 in theokit-gateways

- Status: accepted
- Date: 2026-10-06
- Item: B-420 (`gateway-teams-inbound-verifier`), Step 5.8 code-quality audit

<!-- ADR-DISMISS-SOFT-CAP: auditor_unavailable_knip: knip is not a dependency of theokit-gateways, so `pnpm exec knip` (the runner the kit picks from pnpm-lock.yaml) exits 254 before any analysis; the dead-code pass is repository tooling, and this item adds no dependency to install it -->

## Context

The Step 5.8 audit (`.squad/records/audits/gateway-teams-inbound-verifier-code-quality-2026-10-06.md`)
returned FAIL_SOFT with no hard cap and three soft caps. The plan's D6 dismisses two of them
(`auditor_unavailable_d2_offline`, `soft_cap_mutation_unconfigured_typescript`). The third,
`auditor_unavailable_knip`, is not in the plan: D6 was written against the audit of the `theokit`
repository, and only the theokit-gateways run reports it.

Measured 2026-10-06: the detector runs `pnpm exec knip` because `pnpm-lock.yaml` exists; no
`package.json` in theokit-gateways declares knip, so the command exits 254. `npx --no-install knip`
finds a copy in npx's cache, which the kit deliberately does not use (it would run an unpinned
version). B-421, on the same workspace, recorded the same cap in its plan's ADR D3.

## Decision

Proceed to `/review` with this cap dismissed. The score cap still applies (FAIL_SOFT reaches at
most SHIPPABLE_WITH_CAVEATS).

## Who is affected

Nobody outside this item's review: the cap describes the repository's tooling, not the code. The
dead-code question it would answer is covered for the new files by wiring pillar (a), which
`run_validation.py` re-derived independently (0 pillar (a) failures over the item's symbols), and
by the package's mutation run (91.95% total, `src/verified-claims.ts` 98.15%).

## What would break, and what would not

Nothing breaks: no code, dependency or published file changes. What is lost is a whole-repository
unused-file and unused-export scan, which was not running before this item either.

## Alternatives considered

- Add knip as a root devDependency: rejected, a repository-wide tooling change with its own
  configuration and baseline (knip reports existing unused files elsewhere), outside this item and
  against its "no new dependency" requirement.
- Run knip through npx's cache: rejected, the kit refuses unpinned, unreproducible runs on purpose.
- Stop the item at REVIEW: rejected, the cap is the same one B-421 proceeded past, and stopping
  would treat a tooling gap as a defect of this change.
