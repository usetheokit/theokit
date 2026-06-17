# Review: repo-test-failure-landscape — zod-openapi-drift slice

**Date:** 2026-06-16
**Scope:** the `zod-openapi-drift` slice of the `repo-test-failure-landscape` discovery (blueprint: `discoveries/blueprints/repo-test-failure-landscape-blueprint.md`).
**Diff:** `git diff b8fd95b..HEAD -- packages/theo/src/vite-plugin/openapi-emit/` (commit `7bb1026`) + test docblock fix.
**Reviewer:** 1 independent fresh-eyes agent + deterministic gates (vitest, tsc, eslint).
**Verdict:** `READY_TO_MERGE` (for this slice).

## What this slice fixed

The repo migrated to `zod ^4` but the OpenAPI emitter still read zod-3 internals, producing wrong/empty output. The migration (commit `7bb1026`):

- **`zod-to-openapi.ts`** — normalizes zod 4 `z.toJSONSchema` output to OpenAPI 3.0/3.1: `anyOf`+null → `nullable`; union `anyOf` → `oneOf`; strip redundant `pattern` when `format` present; strip JS safe-integer sentinel bounds on `.int()`; `const` → `enum:[x]` (3.0 compat); re-attach discriminated-union `discriminator` from `def.discriminator`; transform/pipe → input wire shape (`def.in`); fail-loud `ZodToOpenApiError` on `z.function()`.
- **`emit.ts`** — query/path param `required` computed via `child.safeParse(undefined).success` instead of the removed `_def.typeName`.

## Suites fixed (35 tests, all green)

| Suite | Result |
|---|---|
| `vite-plugin-zod-to-openapi` | 15/15 |
| `vite-plugin-openapi-emit-emit` | 13/13 |
| `openapi-emit-spec-compliance` | 4/4 (validates via swagger-parser — incl. a negative control) |
| `openapi-emit-golden-fixtures` | 3/3 |

Full openapi cluster: **67/68** (only `openapi-serve-docs > path traversal` remains — see § Out of scope).

## Gates

| Gate | Result |
|---|---|
| `tsc --noEmit -p packages/theo` | clean |
| `eslint --max-warnings=0` (both files) | clean |
| Type-safety | no new `any`/`@ts-ignore`; schema-internal casts are `as unknown as {...}` (narrowing-from-unknown, allowed by `rules/type-safety.md`) |
| G6 size/complexity | within budget (helpers extracted: `isRecord`/`isNoiseKey`/`normalizeValue`/`convertAnyOf`) |
| No regression | all openapi consumers (`cli-openapi-command`, `config-schema-openapi`, `services-openapi-client-gen`) green |

## Findings (independent review)

| # | Sev | Summary | Disposition |
|---|---|---|---|
| F1 | LOW | Nested discriminated-union (DU inside array/object) emits `oneOf` WITHOUT `discriminator` — `def` is only in scope at the top level of `convertSchema`. Output still spec-valid (discriminator is optional); untested. | **Documented follow-up** (recursive re-attach + test). Non-blocking. |
| F2 | LOW | Stale test docblock claimed "zod 3.25.76 in-house converter". | **Fixed** in this slice (docblock updated to reflect zod-4 `z.toJSONSchema`). |
| F3 | INFO | Widening cast `(result as Record<string,unknown>)[k]` for a dynamic key write. | Accepted (eslint passes). |

## Out of scope (honest boundaries)

- **`openapi-serve-docs > path traversal in specFilePath throws`** — a SECURITY path-traversal gap in the docs-serving file loader (`serve-docs.ts`), with ZERO zod/emit dependency. It is NOT part of the zod-4 drift. Recommended separate finding: `/to-plan serve-docs-path-traversal-guard`.
- **The wider `repo-test-failure-landscape`** (~543 failures): per the blueprint, dominated by **unbuilt-feature RED tests** (saas/postgres templates, `syncTemplates`) that need the user's design specs — NOT fixable in an autonomous cycle. This slice addressed the single cleanest spec-able target. Remaining tractable targets (missing `upgrade-readiness` fixtures, e2e harness) are separate plans.

## Handoff

`READY_TO_MERGE` for the zod-openapi-drift slice — correct, type-safe, fully tested, well-scoped. Two LOW follow-ups (F1 nested-DU discriminator; F3) are non-blocking. The merge to `main` remains the human-gated `/release` step and inherits the develop-branch caveats (the broader pre-existing test debt) documented in the prior review + this blueprint.
