# Edge Case Review — V4-L.1 systemPrompt resolver

Date: 2026-06-25
Tasks analyzed: 3 (T1.1, T2.1, T3.1)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 3, DOCUMENT: 1)

## MUST FIX

(none — the plan already handles the three structural edges: the `compileSubAgents` type break via ADR D3, the `@ProjectContext`+resolver conflict via ADR D2 composition, and backward compatibility via the additive union.)

## SHOULD TEST

### EC-1: resolver base that rejects must propagate (fail-loud), not be swallowed
- **Affected task:** T2.1
- **Family:** State / Format
- **Scenario:** In `compileProjectContext`, `resolvedBase = typeof base === 'function' ? await base(promptCtx) : base` is awaited OUTSIDE the `readProjectInstructions` try/catch. If the app's base resolver throws/rejects (e.g., memory store unavailable), the composed resolver rejects.
- **Why correct:** this IS the desired behavior — a failed prompt assembly must surface, not silently produce a partial prompt (fail-fast). The test locks the contract so a future refactor doesn't accidentally wrap it.
- **Suggested test:** `test_projectContext_resolver_base_rejection_propagates()` — a base resolver that throws causes the composed resolver to reject with the same error.

### EC-2: async resolver base (returns Promise<string>) is awaited correctly
- **Affected task:** T2.1
- **Family:** Format
- **Scenario:** `SystemPromptResolver` may return `string | Promise<string>`. `await base(promptCtx)` handles both, but the async arm should be proven.
- **Suggested test:** `test_projectContext_async_resolver_base_is_awaited()` — a base returning `Promise.resolve('BASE')` composes to a string ending with `BASE` (not `[object Promise]`).

### EC-3: resolver base returning empty string is dropped by `filter(Boolean)` (no dangling separators)
- **Affected task:** T2.1
- **Family:** Boundary
- **Scenario:** A resolver base that returns `''` must not introduce a trailing `\n\n` — the existing `.filter(Boolean)` handles it, but the resolver-base arm should confirm parity with the string-`''` case.
- **Suggested test:** `test_projectContext_empty_resolver_base_no_trailing_separator()` — output has no leading/trailing blank join when the resolved base is empty.

## DOCUMENT

### EC-4: `CompiledSubAgent.systemPrompt` accepts a resolver that is never executed this slice
- **Accepted risk:** Per ADR D3, the type is widened for consistency but sub-agent resolver execution is out of scope (no consumer — `compiled.agents` is not spread into `Agent.create` in `createSdkAgentStream`). The field's JSDoc records this. Adding execution now would be YAGNI (G11). A future slice wires it if a real case appears.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 0 | 0 | 1 (EC-4) |
| T2.1 | 3 | 0 | 3 (EC-1,2,3) | 0 |
| T3.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (3 SHOULD TEST items to absorb into T2.1's TDD; EC-4 documented via ADR D3 — no plan-blocking changes)
