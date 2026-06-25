# Deps Audit: v4l3-runner-runtime-surface

**Date:** 2026-06-25
**Mode:** plan-bound:v4l3-runner-runtime-surface
**Verdict:** PASS_WITH_CAVEATS
**Hard caps triggered:** []

## Summary
- Plan-declared deps: 1 existing (`@theokit/sdk` >=2.9.0), 0 new, 0 removed.
- This slice changes NO manifest — only `.ts` source/test files. The four SDK option types
  (`PluginsSettings`/`ProviderRoutingSettings`/`AgentDefinition`/`BudgetTracker`) are type-only
  imports from the already-installed `@theokit/sdk`; `Agent.create` already accepts them.
- Workspace vulnerabilities (pre-existing, unchanged): 1 high, 4 moderate, 1 low.

## Plan validation (Mode 2)
| Plan dep | Section | Manifest match | Audit clean? | Verdict |
|---|---|---|---|---|
| `@theokit/sdk` (>=2.9.0) | Existing | yes | yes | OK |
| (no new deps) | New | n/a | n/a | OK |

## Pre-existing workspace finding (CAVEAT — does NOT block this slice)
GHSA-vqpr-j7v3-hqw9 — HIGH `valibot@0.42.1` (ReDoS), transitive via `@theokit/ui` in fixtures only.
Unrelated to this slice (not plan-declared, not in the change surface). Tracked separately
(bump `@theokit/ui` past `valibot < 1.2.0`).

## Next steps
1. Proceed to `/plan-confidence`.
2. (Tracked separately) bump `@theokit/ui`.
