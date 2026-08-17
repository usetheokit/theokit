# Edge-case review — ecosystem-integration-guarantee (M48)

**Date:** 2026-07-15 · **Plan:** `ecosystem-integration-guarantee-plan.md` · **Verdict:** MUST-FIX absorbed (2), edge cases mapped.

## MUST-FIX (absorbed into the plan before /plan-confidence re-score)

| ID | Finding | Evidence | Absorbed into |
|---|---|---|---|
| EC-B | The `.test-d.ts` type gate must live where `vitest --typecheck` collects it, else the gate is inert. The runner is `test:types = vitest --typecheck.only --run`; existing convention is `tests/type/*.test-d.ts` (singular). Plan originally used `tests/types/` (plural). | `package.json` scripts; `find . -name '*.test-d.ts'` → `tests/type/*.test-d.ts` | T1.1 path → `tests/type/custom-tool-mirror.test-d.ts` (Baseline, Goal, coverage row 12) |
| EC-C | From the root `tests/` dir, `@theokit/sdk` resolves to **3.5.0** (root hoist), NOT the framework's 4.0.2. Root `package.json:51` devDep is stale `^3.5.0`; `fixtures/template-default` pins `^2.20.0`. A contract test doing `import('@theokit/sdk')` at root would assert against 3.5.0. | `cd tests && node -e require('@theokit/sdk/package.json').version` → `3.5.0`; `grep '"@theokit/sdk"' package.json` → `^3.5.0` | T2.1 pseudo-code → consumer-scoped `createRequire` from `packages/theo` (resolves 4.0.2, mirrors theo-ui `:30-31`); T3.1 → bump root devDep `^3.5.0`→`^4.0.1`; coverage row 11 |

## Edge cases mapped (already covered by the plan's Failure scenarios / Drawbacks)

- SDK absent (optional peer not installed) → boot: no throw unless required; request: lazy `SDK_NOT_INSTALLED` (Failure scenarios row 1; D4).
- SDK below floor (`3.5.0` vs `^4.0.1`) → boot throws typed `SdkIncompatibleError`; drift guard fails (Failure scenarios row 2; T2.2/T3.2).
- Sibling `theokit-sdk` absent on solo checkout → producer test `skipIf(!siblingPresent)` (Failure scenarios row 3). Confirmed present at `../theokit-sdk/packages/sdk@4.0.2` with `prepublishOnly`/`test:contract` BOTH absent (the gap T4.1 closes).
- `transform?` (M18) excess field vs SDK → benign; gate compares the `ctx` param only, not the whole interface (D2).
- Contravariance trap: `toMatchTypeOf` too weak to catch missing `ctx.threadId` → gate uses `toEqualTypeOf` on the `ctx` param (D2).

## Over-engineering check (parsimony)

- No new dependency (no `semver`) — reuses the inline `||`-aware caret checker (parsimony rung 4). ✓
- No new package/abstraction beyond the shared `sdk-compat.ts` (used by drift test + boot check + producer test → Rule-of-3). ✓
- Boot check keeps the lazy request event (defense in depth, not replacement) — justified by D4, not speculative. ✓

## Related drift noted (out of scope, documented not fixed)

- `fixtures/template-default` pins `@theokit/sdk ^2.20.0` (3 majors behind). Recorded in the seam doc version-compat table (T5.1); a scaffold-template bump is a follow-up, not M48's seam work.
