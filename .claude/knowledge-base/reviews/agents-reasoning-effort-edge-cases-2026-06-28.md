# Edge Case Review — agents-reasoning-effort

Date: 2026-06-28
Tasks analyzed: 2 (T1.1 type+helper; T2.1 thread+wire)
Edge cases found: 5 (MUST FIX: 1, SHOULD TEST: 1, DOCUMENT: 3)

## MUST FIX

### EC-1: strict `ReasoningEffort` union blocks provider-specific values at compile time
- **Affected task:** T1.1
- **Family:** Format / Type
- **Scenario:** the plan types `ReasoningEffort = 'minimal'|'low'|'medium'|'high'|'xhigh'`. But provider vocabularies differ (the blueprint noted `xhigh` is OpenAI-only; a provider may accept other values). Since the SDK passes the value through as a STRING and validates against its own catalog (D3), a strict union would reject a legitimate provider value at the TypeScript layer, forcing users to cast around the type.
- **Impact:** valid provider efforts are un-typable; users `as`-cast (defeats the option).
- **Suggested fix:** `type ReasoningEffort = 'minimal'|'low'|'medium'|'high'|'xhigh' | (string & {})` — autocompletes the common set AND accepts forward/provider-specific values, exactly the `AgentRunErrorCode` forward-compat pattern (`agent-events.ts:23-36`). Absorb into T1.1.

## SHOULD TEST

### EC-2: empty-string effort must behave as "no effort" (bare model id)
- **Affected task:** T1.1
- **Suggested test:** `test_buildModelSelection_empty_effort_is_bare_id` — `buildModelSelection('m', '')` → `{ id:'m' }` (no `params`). The `effort ? … : {id}` guard treats `''` as absent; lock it so an empty value never emits a `{id:'thinking',value:''}` the provider would reject.

## DOCUMENT

### EC-3: `reasoningEffort` set on a non-reasoning model (incl. the `openai/gpt-4o-mini` default) → provider error
- **Accepted risk:** per D3 (no static gate), an effort on a model that can't reason surfaces as a provider error mapped to an `error` StreamEvent — visible, not silent. Intentional (Rule 9: SDK is the gate). M3 (theocode) adds model-aware UI gating + a reasoning-capable default. Documented, not blocked.

### EC-4: `@Model('id')` (string) composes with `reasoningEffort` from `@Agent`/run
- **Accepted risk:** `@Model` sets only the model id (via the hierarchical reflector → `compiled.model`); `reasoningEffort` is a separate field (`compiled.reasoningEffort` / run override). They compose cleanly (model from `@Model`, effort from `@Agent`/run) — no interaction bug. Worth a one-line doc in the option JSDoc.

### EC-5: `thinkingBudget?: number` (token-budget knob) deferred
- **Accepted risk:** the blueprint mentioned an alternative numeric `thinkingBudget`. M1 ships the effort enum only (the common, omnigent/AI-SDK shape). A numeric budget would map to `params:[{id:'thinking', value: String(budget)}]` — a trivial future extension of `buildModelSelection`. YAGNI for M1; documented.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 3 | 1 (EC-1) | 1 (EC-2) | 1 (EC-5) |
| T2.1 | 2 | 0 | 0 | 2 (EC-3, EC-4) |

**Verdict:** PLAN NEEDS ADJUSTMENT — absorb EC-1 (forward-compat `(string & {})` union) into T1.1 + add EC-2 empty-effort test; EC-3/EC-4/EC-5 documented.
