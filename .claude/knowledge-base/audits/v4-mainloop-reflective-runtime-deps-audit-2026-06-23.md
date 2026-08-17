# Deps Audit: v4-mainloop-reflective-runtime

**Date:** 2026-06-23
**Mode:** plan-bound:v4-mainloop-reflective-runtime
**Verdict:** PASS
**Hard caps triggered:** [] (none)

## Summary
- Ecosystems detected: npm (pnpm workspace)
- Plan declares: 4 existing peers, 0 new deps, 0 removed.
- Vulnerabilities in the plan's DECLARED deps: **0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW**.
- Workspace-wide `pnpm audit` (context only): 1 HIGH, 4 moderate, 1 low — **none in the plan's declared deps** (see note).
- Auditor coverage: `pnpm audit`: ran. `osv-scanner`: not installed (npm-audit authoritative for npm here).

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `@theokit/sdk` | Existing | yes — peer `>=2.5.0` (`packages/agents/package.json`) | yes (0 advisories) | n/a | OK |
| `zod` | Existing | yes — peer `^4.0.0` | yes (0 advisories) | n/a | OK |
| `@theokit/sdk-tools` | Existing | yes — peerOptional `>=0.2.0` | yes (0 advisories) | n/a | OK |
| `reflect-metadata` | Existing | yes — peer `>=0.2.0` | yes (0 advisories) | n/a | OK |
| (new) | New | n/a | n/a | n/a — none introduced | OK |

## Note — workspace-level pre-existing CVEs (NOT the plan's deps)

`pnpm audit` reports 1 HIGH + 4 moderate + 1 low across the whole workspace. A scoped check confirmed **0 of these advisories touch `@theokit/sdk` / `zod` / `@theokit/sdk-tools` / `reflect-metadata`** — the deps this plan uses. They are the pre-existing transitive dev/fixture CVEs already documented + accepted in `CHANGELOG.md [Unreleased] § Security` (`valibot` via `@theokit/ui`; `esbuild`/`uuid`/`js-yaml` via `drizzle-kit`/`autocannon`/`changesets`) — no production caller, fix is upstream (sibling bumps), explicitly accepted risk. They do NOT cap this plan because the deps-audit golden rule fires `plan_dep_*_cve` only for a CVE in a DECLARED plan dep.

## Recommended next steps
1. No manifest changes needed — the plan introduces zero new deps.
2. Proceed to `/plan-confidence` (already re-scored SHIPPABLE_WITH_CAVEATS 88.8 with the `## Dependencies` section now present).
