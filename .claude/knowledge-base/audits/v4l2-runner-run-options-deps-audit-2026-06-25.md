# Deps Audit: v4l2-runner-run-options

**Date:** 2026-06-25
**Mode:** plan-bound:v4l2-runner-run-options
**Verdict:** PASS_WITH_CAVEATS
**Hard caps triggered:** [] (no CVE on a plan-declared dependency)

## Summary
- Ecosystems: npm (pnpm workspace).
- Plan-declared deps: 1 existing (`@theokit/sdk` >=2.9.0), 0 new, 0 removed.
- This slice changes NO manifest — it edits only `.ts` source/test files (`agent-runner.ts`, `sdk-adapter.ts`, 2 new test files). `cwd`/`local` and `resolveLoopStrategy` are already in use; nothing is added to any `package.json`.
- Auditor: `pnpm audit` ran. Workspace vulnerabilities (pre-existing, unchanged from V4-L.1): 1 high, 4 moderate, 1 low.

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Verdict |
|---|---|---|---|---|
| `@theokit/sdk` (>=2.9.0) | Existing | yes | yes (no CVE on @theokit/sdk) | OK |
| (no new deps) | New | n/a | n/a | OK |

## Pre-existing workspace finding (CAVEAT — does NOT block this slice)

### GHSA-vqpr-j7v3-hqw9 — HIGH (valibot@0.42.1, ReDoS in `EMOJI_REGEX`)
- **Fixed in:** `>=1.2.0`. **Path:** transitive via `@theokit/ui@0.14.4 > valibot@0.42.1`, in fixtures only (17 paths, all rooted at `@theokit/ui`).
- **Relation to V4-L.2:** NONE — same pre-existing transitive vuln noted in the V4-L.1 deps-audit. Not plan-declared, not in this slice's change surface, not imported by `packages/agents/src`. Bumping `@theokit/ui` past the vulnerable `valibot` is a separate workspace-hygiene task.

## Recommended next steps
1. Proceed to `/plan-confidence` — the plan's dependency surface is clean.
2. (Tracked separately) bump `@theokit/ui` past `valibot < 1.2.0`.
