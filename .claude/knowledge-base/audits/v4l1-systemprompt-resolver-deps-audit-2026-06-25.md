# Deps Audit: v4l1-systemprompt-resolver

**Date:** 2026-06-25
**Mode:** plan-bound:v4l1-systemprompt-resolver
**Verdict:** PASS_WITH_CAVEATS
**Hard caps triggered:** [] (none — no CVE on a plan-declared dependency)

## Summary
- Ecosystems detected: npm (pnpm workspace)
- Plan-declared deps: 1 existing (`@theokit/sdk` >=2.9.0), 0 new, 0 removed
- This slice changes NO manifest — `git diff --stat packages/agents/package.json` is empty (verified). `SystemPromptResolver` is a type-only import from the already-installed `@theokit/sdk`.
- Auditor coverage: { pnpm-audit: ran, osv-scanner: present (not needed — pnpm audit sufficed) }
- Workspace vulnerabilities found (pre-existing, NOT introduced by this slice): 1 high, 4 moderate, 1 low

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `@theokit/sdk` (>=2.9.0) | Existing | yes (`packages/agents/package.json:39,51`) | yes (no CVE on @theokit/sdk) | n/a (existing) | OK |
| (no new deps) | New | n/a | n/a | n/a | OK |

The plan's declared dependency surface is clean. No new dependency is introduced.

## Pre-existing workspace finding (CAVEAT — does NOT block this slice)

### GHSA-vqpr-j7v3-hqw9 — HIGH (npm: valibot@0.42.1)
- **Fixed in:** `>=1.2.0`
- **Path:** transitive via `@theokit/ui@0.14.4 > valibot@0.42.1`, reachable only in `fixtures/services-both` (17 paths, all rooted at `@theokit/ui`).
- **Relation to V4-L.1:** NONE. Verified: `valibot` is not imported anywhere in `packages/agents/src` (grep = 0), is not a direct dependency of `@theokit/agents`, and this slice adds no dependency. It is a pre-existing transitive vuln carried by the OPTIONAL peer `@theokit/ui` in test fixtures.
- **Why it does not trigger FAIL_INSECURE:** the deps-audit hard cap fires for a HIGH CVE on a *plan-declared* dependency. `valibot` is neither plan-declared nor in this slice's change surface. Per the skill's transitive-dep rule, a transitive CVE not rooted at a plan-declared dep is a caveat, not a blocker.
- **Recommended follow-up (separate from this slice):** bump `@theokit/ui` to a version whose `valibot` is `>=1.2.0`, OR raise it in the `@theokit/ui` sibling repo. Track as an independent workspace-hygiene task — it predates and is orthogonal to V4-L.1.

## Recommended next steps
1. Proceed to `/plan-confidence` — the plan's dependency surface is clean (PASS_WITH_CAVEATS cap 89 does not block SHIPPABLE_WITH_CAVEATS).
2. File a separate workspace task to bump `@theokit/ui` past the vulnerable `valibot` range (out of scope for V4-L.1).
