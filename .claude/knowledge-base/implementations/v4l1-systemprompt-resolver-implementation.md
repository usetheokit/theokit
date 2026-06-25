# Implementation Summary — V4-L.1 systemPrompt resolver

**Slug:** v4l1-systemprompt-resolver
**Date:** 2026-06-25
**Branch:** develop
**Commits:** `994eadf` (cycle artifacts), `13a4abc` (feat implementation)
**Plan:** `knowledge-base/plans/v4l1-systemprompt-resolver-plan.md` (v1.1, plan-confidence SHIPPABLE_WITH_CAVEATS, weighted_avg 100)

## Result

`@Agent`'s `systemPrompt` now accepts `string | SystemPromptResolver`. A prompt computed per request flows byref from the decorator → `compileAgent` → `Agent.create`. `@ProjectContext` composes with a resolver base. Backward-compatible; no new dependency.

## Tasks (TDD, RED→GREEN→REFACTOR→WIRING→COMMIT)

| Task | RED proof | Status | Wiring triad |
|---|---|---|---|
| T1.1 — widen union (types.ts, agent-compiler.ts) | `tsc -p tsconfig.test.json` failed (resolver not assignable to string) before widening | committed | (a) caller `compileAgent`/`sdk-adapter`; (b) covered by unit + integration; (c) no new metric (n/a) |
| T2.1 — `@ProjectContext` composes resolver base (compile-project-context.ts) | unit tests `test_projectContext_composes_resolver_base` etc. (incl. EC-1 reject / EC-2 async / EC-3 empty) | committed | (a) caller `sdk-adapter.ts:50`; (b) unit tests; (c) n/a |
| T3.1 — integration wiring proof | `test_createSdkAgentStream_passes_resolver_to_agent_create` asserts byref at `Agent.create` | committed | (a)+(b) the test IS the boundary proof; (c) n/a |

## Validation gate

| Check | Command | Result |
|---|---|---|
| Tests (full agents suite) | `npx vitest run` (in packages/agents) | 366 passed, 3 skipped (was 355; +11 new) |
| Typecheck | `npx tsc --noEmit -p packages/agents/tsconfig.test.json` | exit 0 (clean) |
| Lint (changed files) | `npx eslint <5 changed files> --max-warnings=0` | exit 0 (clean) |
| File size (G6) | `wc -l` | types.ts 78, agent-compiler.ts ~150, compile-project-context.ts ~74 — all ≤ 500 |
| Coverage | new branch (`assembleM8CreateOptions` resolver arm + `compileProjectContext` function-base arm) exercised by the new tests | covered |

## Files changed (6)

- `packages/agents/src/types.ts` — `AgentOptions.systemPrompt: string | SystemPromptResolver` + type-only import.
- `packages/agents/src/bridge/agent-compiler.ts` — `CompiledAgentOptions.systemPrompt` + `CompiledSubAgent.systemPrompt` widened (D3 JSDoc on the sub-agent field).
- `packages/agents/src/bridge/compile-project-context.ts` — `base?: string | SystemPromptResolver`; resolve-then-prepend (ADR D2).
- `packages/agents/tests/unit/systemprompt-resolver.test.ts` (NEW) — 9 tests (type, compile carry, compose incl. EC-1/2/3).
- `packages/agents/tests/integration/systemprompt-resolver-stream.test.ts` (NEW) — 2 tests (resolver byref + string byvalue to `Agent.create`).
- `.changeset/v4l1-systemprompt-resolver.md` (NEW) — minor bump.

## Pre-existing issues (NOT introduced by this slice — for PR description)

- Folder-wide `eslint packages/agents/{src,tests}` reports pre-existing lint debt in OTHER test files (empty-class, unused-imports, void-union, `import()` type annotations). None in the V4-L.1 files. lint-staged gates only staged files (which passed). Out of scope.
- Bare `tsc --noEmit` (no `-p`) reports TS6059 rootDir cross-package errors in `../http/src` — a pre-existing monorepo config quirk; the canonical typecheck (`-p tsconfig.test.json`) is clean.
- `pnpm audit` HIGH `valibot` (GHSA-vqpr-j7v3-hqw9) is transitive via `@theokit/ui` in fixtures, unrelated to this slice (see deps-audit report).

## Deviations from plan

None. All 6 coverage-matrix gaps closed; the 3 edge-case SHOULD-TEST items (EC-1/2/3) were absorbed into T2.1's TDD and pass.
