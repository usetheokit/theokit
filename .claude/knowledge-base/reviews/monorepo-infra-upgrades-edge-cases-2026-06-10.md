# Edge Case Review — monorepo-infra-upgrades

Date: 2026-06-10
Tasks analyzed: 7 (T1.1, T1.2, T1.3, T1.4, T2.1, T3.1, Phase 4)
Edge cases found: 5 (MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: llm-runner.ts has its own `._def.typeName` converter — not in plan

- **Affected task:** T1.3 (and T1.4)
- **Family:** Boundary
- **Scenario:** `packages/agents/src/bridge/llm-runner.ts:176-207` has a standalone `convertZodToJsonSchema()` that uses `._def.typeName` with a 10-case switch (ZodObject, ZodString, ZodNumber, ZodBoolean, ZodEnum, ZodArray, ZodOptional, ZodDefault, ZodNullable). `fixtures/demo-faang/server/llm-agent-runner.ts:183` has an identical copy. Both break silently with Zod v4 (`._def` renamed to `._zod`), producing `{ type: 'string' }` for all schemas (the `default` case).
- **Impact:** Agent tool calling sends wrong JSON Schema to LLM → tools never match → agent silently broken. No crash, no error — just wrong behavior.
- **Suggested fix:** Add T1.3b task: replace `convertZodToJsonSchema()` in `llm-runner.ts` with `z.toJSONSchema()` (same pattern as T1.2). Update fixture copy to match. 3 lines: `import { z } from 'zod'; function convertZodToJsonSchema(schema: unknown) { return z.toJSONSchema(schema as z.ZodType) }`.

### EC-2: `packages/theo/tsconfig.json` does NOT extend root — `stripInternal` won't propagate

- **Affected task:** T3.1
- **Family:** State
- **Scenario:** The plan says "Enable `stripInternal: true` in root `tsconfig.json`" and claims "root config inherited by all packages." But `packages/theo/tsconfig.json` is standalone (no `"extends"` field). Since ALL 15 `@internal` occurrences are in `packages/theo/src/`, the fix has zero effect.
- **Impact:** T3.1 completes with no error but `@internal` symbols remain in `packages/theo/dist/*.d.ts`. The acceptance criteria (`grep -r "__resetForTests" packages/theo/dist/`) will FAIL, but the cause will be misdiagnosed.
- **Suggested fix:** Add `"stripInternal": true` to BOTH `tsconfig.json` (root) AND `packages/theo/tsconfig.json` compilerOptions. One line in T3.1 Files-to-edit.

## SHOULD TEST

### EC-3: `z.toJSONSchema()` output for `z.object` may include `additionalProperties: false`

- **Affected task:** T1.2, T1.3
- **Suggested test:** `test_toJSONSchema_no_additional_properties_in_tool_schema()` — assert that the JSON Schema sent to LLM APIs does NOT include `additionalProperties: false`, OR verify that OpenRouter/Anthropic accept it. If it breaks tool matching, strip the key post-conversion.

### EC-4: Turbo `test` task needs vitest.config.ts OR package-level test script

- **Affected task:** T2.1
- **Suggested test:** `test_turbo_test_runs_all_packages()` — verify `npx turbo run test` actually runs tests in packages that have `vitest.config.ts` but may NOT have a `"test"` script in their `package.json`. Turbo requires a matching script name in each package's `package.json` scripts. Packages without `"test"` script will be silently skipped. Check: `packages/theo/package.json` — does it have a `"test"` script?

## DOCUMENT

### EC-5: Zod v4 `z.ZodType` generic parameter change

- **Accepted risk:** Zod v4 changed the generic signature of `z.ZodType<Output, Def, Input>`. Code using `z.ZodType` as a type annotation (found in 12+ files across theo) may get different type inference. Since all code uses `z.ZodType` or `z.ZodTypeAny` as opaque type bounds (not parameterized), this is unlikely to break. If it does, T1.4 catches it. Risk consciously accepted — testing covers it.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 1 | 0 | 1 | 0 |
| T1.3 | 1 | 1 | 0 | 0 |
| T1.4 | 1 | 0 | 0 | 1 |
| T2.1 | 1 | 0 | 1 | 0 |
| T3.1 | 1 | 1 | 0 | 0 |
| Phase 4 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT

The 2 MUST FIX items are structural — EC-1 would cause silent agent breakage (wrong JSON Schema to LLM), and EC-2 would make the entire DTS phase a no-op. Both have trivial fixes (≤3 lines each).
