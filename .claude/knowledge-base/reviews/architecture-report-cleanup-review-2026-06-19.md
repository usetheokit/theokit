# Review — architecture-report-cleanup (2026-06-19)

**Plan:** `.claude/knowledge-base/plans/architecture-report-cleanup-plan.md`
**Branch:** `develop` · **Commits:** `2016fdf`, `1d71d59`, `9ec56a3`, `19612df`
**Verdict:** `READY_TO_MERGE`

## Scope

Resolve every actionable point of `architect-output/architecture-report.md` (84/100, "Refactor Lightly"), reconciled against the authoritative `.claude/rules/architecture.md`, `.dependency-cruiser.cjs`, and `system-design-guardrails.md` (G6/G11/G13).

## Per-step disposition + evidence

| Step | Disposition | Commit / artifact |
|---|---|---|
| 1 — pin structural invariants in CI | ✅ Done (re-scoped) | `2016fdf` — `no-cross-module-internal-import` rule + RED/GREEN regression tests; acyclic already CI-enforced |
| 3 — core purity | ✅ Done | `1d71d59` — `validate-structure` → `config/`; `core-purity.test.ts`; ADR 0027 |
| 4 — decouple vite-plugin from server internals | ✅ Done | `9ec56a3` — `server/internal-api.ts` contract; 9 modules rewired; contract test |
| 2 — server-root tidy | ⏸️ Deferred (net-negative) | `19612df` — ADR 0028 (≈35-site churn, worsens transformer depth, hot file, doesn't fix G6) |
| 5 — renames | ⏸️ Declined (false positives) | `19612df` — ADR 0028 (domain concepts; `storage-manager` public+test-guarded; `process-spawn-helpers` ≠ sibling `process-spawn`) |
| 6 — Node/Web convergence | ⏸️ Deferred | `19612df` — ADR 0028 (risky/high; owned by active plan) |

## Quality gates

| Gate | Result |
|---|---|
| `pnpm typecheck` | ✅ exit 0 |
| `pnpm check:deps` (dependency-cruiser, no-circular + new privacy rule) | ✅ 0 violations (351 modules) |
| `pnpm check:naming` (ls-lint) | ✅ exit 0 |
| `eslint` (scoped to all 19 changed files) | ✅ 0 errors |
| `pnpm --filter theokit build` (tsup) | ✅ exit 0; `validateProjectStructure` present in `dist/index.js` |
| Full `vitest run` | 3771 passed / 25 failed / 13 skipped |

### Test-failure analysis (delta = 0)

The 25 failures are **pre-existing environmental baseline**, identical to the set documented in commit `31b1728`'s CHANGELOG. Proof:

- All 25 live in 6 files (`import-validation`, `migration-guide-recipes`, `changeset-config`, `jobs-crons-docs-presence`, `changelog-0-3-0-url-pattern`, `docs-migration-0-3-rollback`).
- Causes are absent files this environment doesn't generate: `docs/migration/0.2-to-0.3.md`, `docs/concepts/*.md`, unbuilt `packages/create-theo/dist/`.
- **None of the 6 failing test files were touched by this work**, and **no changed file (core/config/server/vite-plugin) appears in any failure.**
- The 88 tests across the 12 files that exercise the changed areas all pass.

## cycle-review hard gates

| Gate | Result |
|---|---|
| Failing tests introduced by this work | ✅ none (0 delta; 25 pre-existing env baseline) |
| New secrets committed | ✅ none |
| Direct commit to `main` | ✅ none (all on `develop`) |
| Co-Authored-By trailer | ✅ absent on all 4 commits |
| CHANGELOG updated | ✅ 4 `arch-report-cleanup` entries |

## Code-quality checks

- **No dead re-exports** — all 36 `internal-api.ts` exports have a vite-plugin consumer (G7).
- **No symbol fabrication** — `tsc --noEmit` green ⇒ every referenced symbol resolves.
- **Behavior preserved** — every move/rewire is `behavior_change: none`; the moved-symbol contract tests assert same-object re-exports.
- **No new cycle** — `internal-api.ts` re-exporting server internals kept the graph acyclic.

## Acceptance criteria

All PASS (verified programmatically): rule present + check:deps green; `core/` node:-builtin-free; `validateProjectStructure` still public; 0 vite-plugin deep server-subdir imports; `internal-api` not leaked to public barrel; ADRs 0027/0028 present; report annotated.

## Verdict

`READY_TO_MERGE` — the three high-value structural improvements shipped with TDD + tests + ADRs and zero regressions; the cosmetic/heuristic remainder is consciously deferred with documented rationale (ADR 0028). The pre-existing 25-failure environmental baseline is outside this work's scope and unchanged.
