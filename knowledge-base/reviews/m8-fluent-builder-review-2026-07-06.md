---
slug: m8-fluent-builder
date: 2026-07-06
verdict: READY_TO_MERGE
plan: knowledge-base/plans/m8-fluent-builder-plan.md
---

# Review: M7 (run-context DI) + M8 (fluent type-state builder)

**Verdict:** READY_TO_MERGE  
**Date:** 2026-07-06  
**Scope:** `packages/agents/`, `packages/theo/src/server/define/`, `tests/unit/`

---

## Initial findings (NEEDS_FIXES — resolved)

Multi-agent review returned NEEDS_FIXES with 3 BLOCKERs and 6 HIGH findings.
All findings were resolved in this session before this READY_TO_MERGE verdict.

### BLOCKERs (all resolved)

| ID | File | Finding | Resolution |
|----|------|---------|------------|
| B1 | `packages/agents/src/bridge/agent-compiler.ts:92` | G3 violation: `as Record<string \| symbol, Function>` without `unknown` intermediate — direct cast from typed value | Fixed: `(instance as unknown as Record<string \| symbol, Function>)[tool.propertyKey]` |
| B2 | `packages/agents/src/bridge/sdk-adapter.ts` (outer generator) | Wiring triad pillar (c) missing for M7 — no runtime metric for run-context injection path | Fixed: `console.debug('[THEO_AGENT_M7_RUN_CONTEXT]', { source, keys })` added before `storage ??=` in outer generator |
| B3 | `tests/unit/define-agent-tool-context.test.ts:27` | TS2554: Expected 1 argument but got 2 — `CustomTool.handler` typed as 1-arg; theokit bridge calls with 2 args | Fixed: Extended `CustomTool` local interface in `define-agent-tool.ts` to `handler(input, ctx?: { signal?, context? })` |

### HIGH findings (all resolved)

| ID | File | Finding | Resolution |
|----|------|---------|------------|
| H1 | `packages/agents/src/bridge/sdk-adapter.ts:118` | Naming collision: `RuntimeOverrides.context` shadowed `ContextSettings.context` | Renamed to `runContext` throughout (interface + call sites + tests) |
| H2 | `packages/agents/src/bridge/sdk-adapter.ts` (generator body) | G6 violation: outer generator body exceeded 50 LoC | Extracted `streamSdkAgent` async generator; outer generator now ≤ 20 LoC; storage `??=` kept in outer scope to preserve closure-level cross-round sharing |
| H3 | `packages/agents/src/bridge/sdk-adapter.ts:282-283` | G3 violations: `sdk.Agent as SdkAgentApi` and `sdk.defineTool as SdkRuntime['defineTool']` without `unknown` | Fixed: `(sdk.Agent as unknown) as SdkAgentApi`, `(sdk.defineTool as unknown) as SdkRuntime['defineTool']` |
| H4 | `packages/agents/src/bridge/sdk-adapter.ts:288` | Error swallowed silently (`catch {}` with `return null`) | Fixed: `console.warn('[theokit] @theokit/sdk import failed:', err)` |
| H5 | `packages/agents/src/bridge/define-agent.ts:96` | G3 violation: `(value as Record<PropertyKey, unknown>)` without `unknown` intermediate | Fixed: `(value as unknown as Record<PropertyKey, unknown>)` |
| H6 | Multiple test files | Missing test assertions documented in DoD (M8 InferAgentInput, M8 `.use()` model assertion, 2 run-context edge cases, M7 signal-without-context negative case) | Added: `expectTypeOf<InferAgentInput<typeof def>>()` in agent-builder.test-d.ts; `expect(built.model).toBe('m')` in agent-builder-runtime.test.ts; `test_empty_context_object_is_forwarded_as_empty_object` + `test_per_run_context_completely_replaces_agent_level_not_merges` in run-context.test.ts; `signal is forwarded independently of context` in define-agent-tool-context.test.ts |

### LOW findings (no action required)

- Stale comment in `define-agent.ts:110-114` about older `@theokit/sdk` types — updated to accurate contravariance explanation
- M8 `console.debug` label `context: applied.includes('context')` → renamed to `contextWindow:` to match the applied field

---

## Post-fix verification

### Type check
```
packages/agents/tsconfig.test.json  — 0 errors
packages/theo/tsconfig.json         — 0 errors
```

### Test suite
```
packages/agents tests — 592 pass, 3 skipped (LLM smoke), 0 failed
tests/unit            — all pass (including new define-agent-tool-context tests)
```

### Critical invariant: cross-round storage sharing
The G6 extraction required careful placement of `storage ??=`. Moving it inside `streamSdkAgent` would have broken the closure-level sharing (each invocation of the generator would reinitialize storage, triggering `test_default_storage_is_in_memory_created_once` failure). The `??=` assignment remains in the outer `async *[Symbol.asyncIterator]()` generator where `storage` IS the factory closure variable.

---

## Security

No secrets, tokens, or credentials in any changed file.

---

## Coverage summary

| Feature | Unit | Integration | Type | Runtime metric |
|---------|------|------------|------|---------------|
| M7 run-context injection | ✅ | ✅ | — | ✅ `THEO_AGENT_M7_RUN_CONTEXT` |
| M7 per-run override | ✅ | ✅ | — | ✅ |
| M7 edge: empty context `{}` | ✅ | ✅ | — | ✅ |
| M7 edge: replace-not-merge | ✅ | ✅ | — | ✅ |
| M7 signal-without-context | ✅ | — | — | — |
| M8 model-set guard | ✅ | ✅ | ✅ | — |
| M8 double-model guard | — | — | ✅ | — |
| M8 context-satisfaction guard | — | — | ✅ | — |
| M8 tool-name accumulation | — | — | ✅ | — |
| M8 InferAgentInput | — | — | ✅ | — |
| M8 convergence (builder ≡ defineAgent) | — | ✅ | — | ✅ `THEO_AGENT_M8_OPTIONS` |
| M8 .use() preset | ✅ | ✅ | — | — |

---

## Verdict rationale

All 3 BLOCKERs resolved. All 6 HIGH findings resolved. G3 guardrail now satisfied across all changed files. Wiring triad complete for M7 (caller ✅, integration test ✅, runtime metric ✅). Test suite green (592 pass). Type check clean. No new dead exports. Cross-round storage sharing invariant preserved.

**READY_TO_MERGE**
