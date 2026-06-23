# Implementation Summary — M8 Decorator Runtime

**Slug:** m8-decorator-runtime
**Milestone:** M8 (Camada declarativa — Tema F / Seção 6)
**Plan:** `.claude/knowledge-base/plans/m8-decorator-runtime-plan.md` (v1.1, plan-confidence SHIPPABLE 93.2)
**Date:** 2026-06-22
**Promise:** `IMPLEMENTATION_COMPLETE`

## What shipped

The three `@theokit/agents` declarative decorators that were **metadata-only** now have
SDK-backed runtime, compiled by the bridge and executed by `@theokit/sdk` (per
`sdk-runtime.md`):

| Decorator | Compiles to | Module |
|---|---|---|
| `@Skills` | `AgentOptions.skills` (`SkillsSettings {enabled?, autoInject}`) + `local.settingSources:['project']` (EC-1) | `bridge/compile-skills.ts` |
| `@ContextWindow` | `AgentOptions.context` (`ContextSettings.maxTokens`) | `bridge/compile-context-window.ts` |
| `@ProjectContext` | `AgentOptions.systemPrompt` resolver (env + repo map + `THEO.md`) | `bridge/compile-project-context.ts` |

Knobs with no native SDK mapping emit stable `THEO_AGENT_CONTEXT_STRATEGY_METADATA_ONLY` /
`THEO_AGENT_PROJECT_CONTEXT_KNOB_METADATA_ONLY` warnings (G10 honest enforcement) instead of
silently no-op'ing. M8-4 strategic decision recorded in ADR 0031.

## Tasks / commits (TDD per task)

| Task | Commit | Wiring triad |
|---|---|---|
| T0.1 — dep bump `@theokit/sdk@^2.5.0` + `@theokit/sdk-tools` | `a670ad9` | caller: workspace install; test: resolution probe; metric: n/a (deps) |
| T1.1 — `@Skills` → `SkillsSettings` | `32a6dc3` | caller: `agent-compiler` + `sdk-adapter`; test: `m8-skills-compile` + `m8-adapter-wiring`; metric: `THEO_AGENT_M8_RUNTIME_APPLIED` |
| T2.1 — `@ContextWindow` → `ContextSettings` + warn | `bbae6b7` | caller: `walk` + `agent-compiler` + `sdk-adapter`; test: `m8-context-window-compile`; metric: warning code + applied log |
| T3.1 — `@ProjectContext` → `SystemPromptResolver` | `704bce5` | caller: `walk` + `sdk-adapter`; test: `m8-project-context-compile`; metric: warning code + applied log |
| T4.1 — wire all three into `Agent.create()` | `8165c5f` | caller: `sdk-adapter.assembleM8CreateOptions`; test: `m8-adapter-wiring` (5); metric: `THEO_AGENT_M8_RUNTIME_APPLIED` debug |
| T5.1 — M8-4 ADR | `bcab32e` | docs (no code) |

## Validation (Final Phase)

- `pnpm --filter @theokit/agents test` → **260 passed | 3 skipped** (baseline 239 + 21 new M8).
- `tsc --noEmit -p packages/agents/tsconfig.test.json` → **clean**.
- `tsc --noEmit -p packages/theo/tsconfig.json` → **clean** (SDK 2.0.1→2.5.0 bump did not regress the principal `theo`).
- `pnpm --filter @theokit/agents build` (tsup ESM+CJS+DTS) → **success**.
- Lint: all 8 M8 source/test files clean; the 30 whole-dir `eslint packages/agents` problems are **pre-existing** config/legacy-test project-service noise (zero M8 files — verified by filter).
- Runtime-metric proof: `THEO_AGENT_M8_RUNTIME_APPLIED` observed in `m8-adapter-wiring` integration test; both metadata-only warning codes observed in their unit tests.

## DoD

- [x] Zero of the three decorators remains metadata-only — each compiles to a non-empty `AgentOptions` field reaching `Agent.create()`.
- [x] Un-forwardable knobs warn (stable codes), never silent.
- [x] Backward compatible — decorator option shapes unchanged; absent-decorator `Agent.create` adds no keys.
- [x] CHANGELOG updated (`[Unreleased]` Added + Changed, M8).
- [x] ADR 0031 present.
- [x] Dependency direction main→libs preserved (ADR 0030); agents→sdk / agents→sdk-tools only.

## Deviations from plan

- **`@ProjectContext` cwd fallback (Q3/EC-3):** the plan said fall back to `process.cwd()` when `SystemPromptContext.cwd` is undefined. Implemented instead as **return the base prompt** (no repo map) — `process.cwd()` is a Node API and G8 keeps `packages/agents/src` free of direct `process` access; a resolver without a known cwd should not guess. Strictly more correct + guardrail-compliant. Test updated to `test_project_context_resolver_no_cwd_returns_base`.

## Follow-ups (out of M8 scope)

- A per-package `@theokit/agents/CHANGELOG.md` (currently only the workspace-level CHANGELOG carries the entry).
- Real-LLM dogfood of an `@ProjectContext` agent end-to-end (unit/integration mock the SDK; the `<skills>`/repo-map injection is asserted by shape, not a live model call).
