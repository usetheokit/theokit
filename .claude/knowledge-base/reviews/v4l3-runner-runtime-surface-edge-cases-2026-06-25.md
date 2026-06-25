# Edge Case Review — V4-L.3 runner runtime surface

Date: 2026-06-25
Tasks analyzed: 2 (T1.1, T2.1)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

(none — the four fields reuse the proven flat-run-option mechanism + the SDK's existing `Agent.create` keys; the `RuntimeOverrides` refactor is typecheck-guarded across all 5 call sites; `agents` is opts-only so the V4-L.1 D3 deferral is untouched.)

## SHOULD TEST

### EC-1: `budget` (outer loop, USD) and `budgetTracker` (inner SDK, iterations) coexist
- **Affected task:** T2.1
- **Family:** State
- **Scenario:** ADR D4 claims the two budget-shaped fields operate at different layers. A regression could let one path drop the other (e.g. the overrides object shadowing `opts.budget`, which is NOT part of RuntimeOverrides).
- **Suggested test:** `test_budget_and_budgetTracker_coexist()` — one call with both `budget` and `budgetTracker`: assert `captured.budgetTracker` reaches `Agent.create` AND the run still completes (outer `budget` not exceeded at zero cost).

### EC-2: an empty-array override (`plugins: []`) is forwarded, not omitted
- **Affected task:** T2.1
- **Family:** Boundary
- **Scenario:** The conditional spread guards on `!== undefined`, so `plugins: []` (the app explicitly choosing "no plugins") must reach `Agent.create` as `[]`, not be dropped. A `truthy`/length check instead of `!== undefined` would wrongly omit it.
- **Suggested test:** `test_empty_plugins_array_is_forwarded()` — `run('hi', { apiKey, plugins: [] })` → `captured.plugins` is `[]` (defined, length 0).

## DOCUMENT

### EC-3: `@SubAgents` `compiled.agents` stays unspread (V4-L.1 D3 deferral)
- **Accepted risk:** Per ADR D3, the per-request `agents` override is opts-only; an agent declaring `@SubAgents` and running through `AgentRunner` without `opts.agents` still does NOT forward `compiled.agents` (`CompiledSubAgent` is not an `AgentDefinition`). Unchanged from V4-L.1; future work with a real consumer.

### EC-4: SDK `plugins` type wart (`PluginsSettings` vs runtime `Plugin[]`)
- **Accepted risk:** The SDK `.d.ts` types `plugins` as `PluginsSettings` (`{enabled}`) while the runtime accepts `Plugin[]`; theocode casts `as unknown as PluginsSettings`. The run-option mirrors the SDK's `PluginsSettings` (so `createSdkAgentStream` forwards without a cast); the app keeps its existing cast. Fixing the SDK type is out of scope (an SDK concern).

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 2 | 0 | 0 | 2 (EC-3, EC-4) |
| T2.1 | 2 | 0 | 2 (EC-1, EC-2) | 0 |

**Verdict:** PLAN OK (2 SHOULD TEST items to absorb into T2.1; EC-3/EC-4 documented via ADRs — no plan-blocking changes)
