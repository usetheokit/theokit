---
slug: test-debt-stabilization
milestone_id:
created_at: 2026-07-05
goal: Zero the pre-existing red unit tests on develop (test-hygiene debt surfaced during the M6 npm-install fix) with no product-behavior change.
---

# Plan — Test-debt stabilization

## Goal

Make `develop`'s unit suite green by resolving the pre-existing failures that predate (and are
unrelated to) the M6 npm-install fix. No product behavior changes — this is test hygiene + one
fixture dependency sync + one architecture-allowlist update.

## Baseline context

Surfaced while fixing the M6 `@theokit/ui` peer `ERESOLVE` (theokit@0.15.2). Clean-tree
`npx vitest run tests/unit/` shows these failing, root-caused below. None are caused by the M6 fix
(confirmed via `git stash` baseline).

| Finding | File(s) | Root cause | Class |
|---|---|---|---|
| F1 | `tests/unit/cli-cleanup-rename.test.ts` (2 tests) | Asserts a `cli/cleanup/index.ts` barrel + a 3-file dir listing. The barrel was never adopted — `packages/theo/src/cli/commands/build.ts:33` imports `cleanOutDir` directly from `../cleanup/cleanup.js`. `gcAgentRegistry` is defined but only referenced in a comment. | Stale test |
| F2 | `tests/unit/r3a-web-crypto-migration-leaf.test.ts` (1 test) | `NODE_ONLY_ALLOWLIST` misses two legitimately Node-only leaves added after the allowlist was written: `server/scan/agent-scan.ts` (M2 build-time scanner, `node:fs`) and `server/agent/render-terminal.ts` (M5 terminal harness, `node:readline`/`node:stream`). The invariant test correctly flags un-registered leaves. | Real invariant-maintenance gap |
| F3 | `tests/unit/changelog-0-3-0-url-pattern.test.ts` + `tests/unit/docs-migration-0-3-rollback.test.ts` (collection errors) | Both reference `docs/migration/0.2-to-0.3.md`, a 0.3.0-era doc removed long ago (current is `0.13-to-0.14-agent-surface.md`; we are at 0.15). ENOENT on collection. | Stale test (obsolete cohort) |
| F4 | `tests/unit/devtools-treeshake.test.ts` (1 test) + `tests/unit/bundle-budget.test.ts` | `theokit build` on `fixtures/template-default` fails: Rollup can't resolve `@usetheo/ui`, which the template `app/page.tsx` imports but the fixture `package.json` does not declare. The end-user build is proven to work (theokit@0.15.2 smoke). | Fixture-sync gap |

## Coverage matrix

| Goal claim | Task |
|---|---|
| F1 stale barrel test aligned to real structure | T1 |
| F2 Node-only leaves registered in allowlist | T2 |
| F3 obsolete 0.3.0-era tests removed | T3 |
| F4 fixture declares `@usetheo/ui`; devtools-treeshake + bundle-budget green | T4 |
| No product-behavior change; full suite green | T5 (gate) |

## Tasks

### T1 — Align `cli-cleanup-rename` to the real (barrel-less) structure
- The barrel was never adopted (`build.ts` imports `cleanup.js` directly). Update the two tests to
  assert the real contract: `cleanup.ts` exports `cleanOutDir` + `gcAgentRegistry`, and `build.ts`
  imports `cleanOutDir` from the direct path. Drop the `index.ts`-barrel expectation.
- Acceptance: the 2 tests pass asserting the ACTUAL structure; no barrel file is created (a barrel
  with no importer would be a dead export, G7).

### T2 — Register the two Node-only leaves in `NODE_ONLY_ALLOWLIST`
- Add `packages/theo/src/server/scan/agent-scan.ts` (Build-time scanners group) and
  `packages/theo/src/server/agent/render-terminal.ts` (new "Terminal harness — CLI-only" group) with
  justification comments matching the file's role, per ADR-0028.
- Acceptance: the invariant test passes; both entries carry a one-line rationale.

### T3 — Delete the obsolete 0.3.0-era migration tests
- Remove `tests/unit/changelog-0-3-0-url-pattern.test.ts` and
  `tests/unit/docs-migration-0-3-rollback.test.ts` — they validate `docs/migration/0.2-to-0.3.md`,
  removed 12 versions ago (audit-trail-rotation: obsolete cohort). Confirm no other test/source
  references them.
- Acceptance: both files gone; collection errors cleared; no dangling reference.

### T4 — Sync the `template-default` fixture with the template's `@usetheo/ui` use
- Add `@usetheo/ui` to `fixtures/template-default/package.json` at the same range the template pins
  (`^0.14.0`), then `pnpm install` so the fixture resolves it. This is the fixture mirroring the
  template — the template's `app/page.tsx` imports `@usetheo/ui`.
- Acceptance: `devtools-treeshake` (build succeeds) and `bundle-budget` pass.

### T5 — Full-suite gate
- Run the full `vitest run` (unit + integration) and confirm zero failures introduced and the four
  findings cleared. Any residual failure is triaged before closing.
- Acceptance: full suite green (or any residual explicitly triaged + owned).

## Drawbacks & risks

1. **Editing tests can mask a real regression.** Mitigation: F1/F3 are provably stale (evidence:
   direct-import in build.ts; deleted doc 12 versions old). F2 registers files proven Node-only by
   inspection. Only F4 touches a non-test file (fixture `package.json` — additive dep).
2. **`gcAgentRegistry` may be dead code** (defined, no caller). Out of scope here (test-hygiene, not
   dead-code removal) — noted for a follow-up `/code-quality` pass, not silently absorbed.
3. **Fixture install may pull an unexpected `@usetheo/ui`.** Mitigation: pin the same range the
   template uses; re-run the build to confirm.

## Scope expansion (found by the full-suite run, beyond the initial unit-only diagnosis)

The full `vitest run` (unit + integration + smoke) surfaced more pre-existing debt than the
unit-only pass. All root-caused and resolved:

| Finding | Root cause | Resolution |
|---|---|---|
| F5 `contract-usetheo-ui-vite-plugin` EC-7 (1) | `satisfiesCaretPrerelease` didn't handle `||`-joined ranges (stale since the V3-2 widening) | Split on `||`, satisfy-if-any-clause |
| F6 `changeset-config` (2) | Asserted theokit + create-theokit are version-linked; they are independently versioned (0.15.x vs 1.0.x) | Assert reality (not linked; versions may diverge) |
| F7 `import-validation` (6) | Validated the absorbed-dead `packages/create-theo`; templates `dashboard`/`api-only` removed (ADR-0023) | Retarget to `create-theokit`; templates default-only |
| F8 `migration-guide-recipes` (7) | 0.2-to-0.3 migration cohort (12 versions old), same as F3 | Deleted (obsolete cohort) |
| F9 `jobs-crons-docs-presence` (11) | `docs/concepts/*.md` removed; features still exist; docs recoverable from git @9d29df8 | **Decision (operator, 2026-07-05): concept docs are not a repo deliverable — delete the test.** |

## Final gate result (full `vitest run`)

**3740 tests passed, 0 assertion failures, 17 skipped** — all nine test-debt findings resolved.

The only remaining file-level failure is `tests/integration/wrangler-smoke.test.ts`: its `beforeAll`
spawns `wrangler dev` (Cloudflare Workers under Miniflare) which cannot start in this sandbox (no CF
toolchain / network), so the hook times out at 90 s and its 3 tests are skipped (no assertion
failed). This is **environmental and out of scope** — CF Workers is an opt-in, team-unvalidated
compatibility surface per CLAUDE.md. Recommended follow-up (verifiable only where the wrangler
toolchain is available, e.g. CI): guard the suite to `describe.skipIf(!wranglerUsable)` so it skips
cleanly instead of failing on a hook timeout. Not blind-fixed here — a change to a CF smoke must be
verified green with the CF toolchain present, which this environment lacks.

## Unresolved questions

- (none) — every finding root-caused with file:line evidence. F9 was an operator decision (docs
  out-of-repo), not an ambiguity in the code. The `wrangler-smoke` hook timeout is environmental,
  not test debt introduced or owned by this pass.

## Test plan

Each task re-runs its own failing test to green (RED already observed on develop). T5 runs the full
suite. No new product code; the only non-test edit is the fixture `package.json` dep (F4).
