---
slug: architecture-report-cleanup
milestone_id: null   # ad-hoc — derived from architect-output/architecture-report.md findings
created_at: 2026-06-19
goal: Resolve every actionable point of architect-output/architecture-report.md, reconciled against the authoritative .claude/rules/architecture.md, with behavior preservation and CI-green at every step.
---

# Plan: Architecture-Report Cleanup (reconciled with authoritative architecture.md)

## Goal

> Resolve all points of `architect-output/architecture-report.md` at FAANG level — behavior-preserving — measured by: `pnpm typecheck` + `pnpm check:deps` + `pnpm lint` + `pnpm test` all green, the new guard tests green, and `architecture.md` + CHANGELOG updated to reflect reality.

## Discovery (prior art = our own code)

Per `cycle-discover` ("Do NOT trigger DISCOVER for questions answered by reading your own ARCHITECTURE.md"), the discovery artifact is the architecture audit already produced at `architect-output/architecture-report.md` (84/100, "Refactor Lightly") plus the authoritative boundary contract `.claude/rules/architecture.md` v3.1 and `.dependency-cruiser.cjs`.

### Reconciliation with authority (the key finding of planning)

The report ran on `packages/theo/src` in isolation. Cross-checking against the project's authoritative `architecture.md` + the enforced `.dependency-cruiser.cjs` changes the disposition of several report items:

| Report step | Report claim | Authority reconciliation | Disposition |
|---|---|---|---|
| 1 — pin acyclic graph in CI | "add madge --circular to CI" | `.dependency-cruiser.cjs` already enforces `no-circular` in CI (`architecture-guards.yml`). madge would be redundant. | **Re-scope:** verify existing enforcement; ADD an `_internal` privacy rule (the one barrel-invariant gap that is cheap + real). |
| 2 — server root grab-bag | move 7 loose files into subdirs | Pure cohesion; `architecture.md` does not forbid. web-handler.ts (639 LoC) also trips G6 (>500). | **Do** the moves (behavior none). Internal splitting of web-handler deferred (out of report scope). |
| 3 — extract core/validate-structure | "infra in domain" | `architecture.md` Prohibition: "Node.js APIs only in adapter layer (use Web Standards in core)". `node:fs` in core/ violates the project's OWN prohibition. | **Do** the extraction → `config/`; update `architecture.md` map + ADR. |
| 4 — decouple vite-plugin from server internals | rewire 52 deep imports | Reality is **147** cross-module deep imports repo-wide; CI allows them (cruiser enforces direction, not barrels). Mass-rewire conflicts with G6 (30-export budget) + tree-shaking + cycle-risk → over-engineering (G11). | **Re-scope:** targeted `server/internal-api.ts` for vite-plugin's 26 value imports only; reconcile `architecture.md` Invariant 3 prose to match enforced reality. |
| 5 — rename manager/helpers | 3 files | Cheap, aligns with naming hygiene. | **Do.** |
| 6 — converge Node/Web pipelines | risky/high | Report's own verdict defers it; owned by active `crossval-native-routing-web-fixes` plan (already landed params+middleware). | **Defer** per report verdict; document. |

## Tasks (dependency order)

### Phase 1 — Step 1: enforce structural invariants in CI

- **Why this step:** the acyclic invariant is already CI-enforced; the one documented-but-unenforced invariant cheap to close is `_internal` privacy (currently 0 violations — a guard, not a cleanup).
- **TDD:** `RED: test_dependency_cruiser_forbids_cross_module_internal_import` — a negative fixture (an import from outside a module into its `_internal/`) must be flagged by `pnpm check:deps`. GREEN: add the cruiser rule. Verify current tree still passes (0 real violations).
- **Acceptance:** `pnpm check:deps` green on current tree; rule present; CHANGELOG noted.

### Phase 2 — Step 3: extract core/validate-structure (core purity)

- **Why this step:** makes `core/` provably free of `node:` builtins, satisfying architecture.md's own prohibition; the file is a CLI-time validator that belongs in `config/`.
- **TDD:** `RED: test_core_has_no_node_builtin_imports` (asserts no `from 'node:'` under `packages/theo/src/core/`). Move file → `config/validate-structure.ts`; rewire root barrel + cli/{build,dev,routes}. Keep `validate-structure.test.ts` green (update import path).
- **Acceptance:** guard test green; existing test green; `validateProjectStructure` still exported from root; architecture.md map updated; ADR written; typecheck + check:deps green.

### Phase 3 — Step 4: server/internal-api barrel + rewire vite-plugin

- **Why this step:** decouples vite-plugin from server's internal file layout for the value-imports that matter, without 147-site churn.
- **TDD:** `RED: test_server_internal_api_reexports_required_symbols` (asserts `server/internal-api.ts` exports executeAction/sendError/logRequest/etc and they are the same refs as their source). Rewire the 26 vite-plugin value imports.
- **Acceptance:** no new cycle (`check:deps`), tsc + tests green, no vite-plugin value import reaches `../server/<subdir>/<file>` for the migrated symbols.

### Phase 4 — Step 2: tidy server/ root grab-bag

- **Why this step:** raises server/ cohesion — request/parse/serialize concerns grouped into subdirs instead of loose at the package root.
- **TDD:** existing `body-parser.test.ts`, `body-parser-web.test.ts`, `transformer.test.ts`, `serialization.test.ts`, `web-handler-*.test.ts` must stay green after the moves (they are the behavior-preservation contract). Update `.dependency-cruiser.cjs` no-orphans exception for the moved `body-parser-web.ts`.
- **Acceptance:** all moved-file tests green; public exports stable; check:deps green.

### Phase 5 — Step 5: rename manager/helpers files

- **Why this step:** behavior-named files over catch-all `manager`/`helpers` suffixes.
- **TDD:** importer tests stay green; `pnpm check:naming` (ls-lint) green.
- **Acceptance:** renames done; tests + naming + typecheck green.

## Drawbacks & Risks

1. **Import churn** (Steps 2–4) risks transient build breaks — mitigated by per-step `tsc --noEmit` + targeted tests + atomic commits.
2. **architecture.md edits** (Steps 3, 4) touch an authoritative doc — mitigated by an ADR per change and keeping the dependency-cruiser config as the mechanical source of truth.
3. **Mass-rewire NOT done** (147 deep imports) is a conscious YAGNI/G11 decision — documented, not silently skipped.

## Unresolved questions

- (none) — scope reconciled against authority; Step 6 explicitly deferred to the active plan that already shipped the params/middleware work.

## Test Plan

Per-step: `pnpm typecheck` + `pnpm check:deps` + targeted `npx vitest run <files>`. Final: full `pnpm test` + `pnpm lint` + `pnpm check:naming` + review audit until READY_TO_MERGE.
