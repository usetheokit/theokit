# Discovery Blueprint — Repo Test-Failure Landscape

**Date:** 2026-06-16
**Question:** What is the root-cause landscape of the ~543 failing tests on `develop`, and is "fix to READY_TO_MERGE" a tractable single cycle?
**Method:** full `npx vitest run` (default reporter, completed) for totals; targeted per-file runs for root-cause evidence. JSON-reporter full run timed out (>500s — the suite is too slow + some broken tests hang), so per-file sampling was used for classification.

## Headline numbers (verified)

`npx vitest run` on `develop` (commit `b8fd95b`): **131 test files failed / 375 passed / 1 skipped (507)** — **543 tests failed / 3391 passed / 68 skipped (4002)**.

**None of the 7 test files from the crossval-native-routing-web-fixes plan are among the failures** (verified). This plan's work added 0 failures.

## Root-cause classes (evidence-backed sample, 8 files of 131)

| Class | Evidence (real error) | Files (sampled) | Nature |
|---|---|---|---|
| **Unbuilt feature — templates** | `ENOENT .../create-theo/templates/saas/server/routes/agent.ts`; `packages/create-theokit/templates/` contains ONLY `default` (saas/postgres = 0 tracked files); `missing package.json.tmpl: expected false to be true` | `scaffold-saas-template` (8), `template-postgres` (10), `template-html-validator` (1) | **RED tests for templates not yet created.** Tests encode a target template set (saas, postgres, …) that the repo has not implemented. |
| **Unbuilt feature — missing source symbol** | `TypeError: syncTemplates is not a function` | `sync-template-versions` (8) | The imported function does not exist in source — RED test for unimplemented code. |
| **Behavior drift (zod v4?)** | `expected { type: 'integer', …(2) } to deeply equal { type: 'integer' }`; `{ type: 'string', …(2) } ≠ { type: 'string', format: 'email' }` | `vite-plugin-zod-to-openapi` (8), `vite-plugin-openapi-emit-emit` (2) | The zod→OpenAPI emitter produces extra/different fields vs. the test's expectation. Likely zod v4 output drift OR stale test expectations. Fixable without feature specs. |
| **Validation/scan logic** | `TheoProjectError: Invalid Theo project structure` thrown where test expects no throw; `expected 0 to be >= 2` | `validate-structure` (2), `ws-scan` (1) | Validator/scanner rejecting or finding nothing — needs case-by-case triage (stale test vs real bug). |
| **Missing fixtures** | `'no-project-detected'` — `fixtures/upgrade-readiness-{clean,dirty}` absent (repo-root `fixtures/` has 6 tracked files, not these) | `cli-upgrade-readiness` (8) | Fixture dirs never committed / absent on `develop`. Restorable from the scanner+test contract. |
| **Missing e2e harness** | `playwright.config.ts` absent on `develop` (only in a worktree); served fixture app absent | `tests/e2e/*.spec.ts` | Playwright config + app fixture not on `develop`. |

## Key finding

The landscape is **heterogeneous and dominated by in-progress / unbuilt feature work**, NOT by "test infrastructure to restore":

- The largest clusters (`scaffold-saas`, `template-postgres`, `sync-template-versions`, `template-html-validator`) are **TDD-RED tests for features the repo has not yet implemented** — additional create-theokit templates (saas, postgres) and source functions (`syncTemplates`). Making them green = **building those features**, which requires the user's design intent / specs (what each template + function should contain). It is not infra restoration.
- A **minority** of failures are tractable without feature specs: behavior drift (`zod-to-openapi`/`openapi-emit` — fixable as a drift), missing fixtures (`upgrade-readiness` — restorable from contract), and the e2e harness (config + fixture app, restorable).

## Conclusion (honesty gate)

**"Fix the whole repo-test-failure-landscape to READY_TO_MERGE" is NOT a tractable single cycle.** The bulk requires building unbuilt features (templates, functions) per the user's specs — which I cannot supply or guess without violating the 95%-confidence rule (fabricating template/function content to make RED tests green would produce garbage and destroy the user's intended design). This is roadmap work, not a bug-fix or infra-restore plan.

## Recommended scoped targets (each a separate, spec-able plan)

1. **`zod-openapi-drift-fix`** — triage the ~10 `zod-to-openapi`/`openapi-emit` failures: determine if zod v4 changed the emitter output (update tests) or the emitter regressed (fix code). Tractable WITHOUT feature specs. **Best first target.**
2. **`restore-upgrade-readiness-fixtures`** — recreate `fixtures/upgrade-readiness-{clean,dirty}` from the scanner+test contract (8 tests). Self-contained.
3. **`restore-e2e-harness`** — materialize `playwright.config.ts` + the served fixture app on `develop` (or document e2e as CI-only and `describe.skip` locally). Needs a decision on the e2e strategy.
4. **`build-create-theokit-templates`** (LARGE, needs user specs) — implement the saas/postgres/… templates + `syncTemplates` the RED tests demand. This is feature/roadmap work — out of scope for an autonomous cycle; needs the user's template designs.

## Coverage Corner notes (honest limits)

- **Sample size:** 8 of 131 failing files were root-caused with real error evidence; classification of the remaining ~123 is inferred from file-name clustering (template-*, openapi/vite-plugin-*, scan-*) + the verified totals, NOT a complete census. A full census needs a faster suite run (the JSON reporter timed out at 500s).
- **No fabrication:** every class above cites a real error message from a real per-file run.
