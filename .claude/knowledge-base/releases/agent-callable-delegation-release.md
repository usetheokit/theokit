# Release run — agent-callable-delegation

Date: 2026-08-15
Input verdict: `READY_TO_MERGE` (`reviews/agent-callable-delegation-review-2026-08-15.md`)
**Verdict: `PR_OPEN_AWAITING_APPROVAL`**

---

## State

| Item | Value |
|---|---|
| Promotion PR | [usetheodev/theokit#312](https://github.com/usetheodev/theokit/pull/312) — `workspace → develop` |
| Head | `46aca0cb` (pushed, pre-push gates green) |
| Changesets pending | 2 — `@theokit/agents` minor, `theokit` patch |
| Release PR (`develop → main`) | not opened — blocked upstream by #312 |
| Tag | not cut |

## Why the cycle stops here

`develop` branch protection requires an approving pull-request review
(`required_pull_request_reviews != null`). I cannot approve my own PR, and doing so would defeat the
gate rather than pass it. This is `cycle-release`'s designed human gate, not a failure.

## The CI red, and what it is not

All seven checks on #312 report FAILURE. **None of them ran.** Every job carries the same
annotation:

> The job was not started because recent account payments have failed or your spending limit needs
> to be increased. Please check the 'Billing & plans' section in your settings.

This is a GitHub Actions account-billing condition, not a code result. It predates this work — runs
`31861921019` and `31862020476` on `workspace` failed identically before any of these commits
existed. It is also not something further engineering resolves; the account owner has to.

`required_status_checks.contexts` is empty, so these checks do not gate the merge. The review does.

## What the CI would have run, run locally instead

Rather than assert the checks "would have passed", every guard the workflow invokes was executed
against the pushed tree:

| Guard | Result |
|---|---|
| `scripts/check-package-direction.mjs` | PASS |
| `scripts/check-surface-parity.mjs` | PASS — includes the new `createDelegateTool` export |
| `scripts/check-sandbox-parity.mjs` | PASS |
| `scripts/check-wire-parity.mjs` | PASS |
| `pnpm check:naming` (ls-lint) | PASS |
| `pnpm check:deps` (dependency-cruiser) | PASS — 0 violations, 412 modules |

Plus the full gate chain: `pnpm test` 806 files / **6275 passed** / 0 failed, `pnpm typecheck`
green, `pnpm lint` green across 9 groups, `/code-quality` **PASS** with 0 findings.

One workflow reference is stale but harmless: `scripts/check-auth-parity.mjs` appears in two `paths:`
trigger filters and does not exist in the repo. A path filter on a missing file simply never
matches; no job invokes it.

## To resume

1. A human approves #312; merge it (promotion).
2. `pnpm changeset version` → `develop → main` release PR + semver tag → `pnpm release`.
3. The two pending changesets cut `@theokit/agents` minor and `theokit` patch.

## Carried caveats

- `pnpm knip` fails on `packages/http` configuration debt — verified identical without this change.
- `package.json` (root) and `packages/presenter/package.json` carry the same `@theokit/sdk`
  dev-vs-peer range divergence that was fixed in `packages/theo`. The peer-range suite's `MANIFESTS`
  list covers only `theo` and `agents`, so it does not see them. Recorded, not fixed — a peer floor
  is a per-manifest consumer-facing decision.
