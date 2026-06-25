# Edge Case Review — v4f-compaction-strategy

Date: 2026-06-25
Tasks analyzed: 4 (T0.1, T1.1, T2.1, T3.1)
Edge cases found: 7 (MUST FIX: 1, SHOULD TEST: 4, DOCUMENT: 2)

The plan is a small, well-bounded Strategy slice mirroring the shipped V4-C/V4-D precedent. Boundaries: the `@theokit/sdk/compaction` module call (T1.1/T3.1), the decorator-metadata read (T2.1), the version skew (T0.1), and the builder resolution precedence (T3.1). No concurrency, no network/DB. The edges below are all real (each has happened in this codebase's sibling slices) and each fix is ≤ 1 sentence or ≤ 3 lines.

## MUST FIX

### EC-1: `@Compaction` + `.compaction()` precedence is undefined
- **Affected task:** T3.1
- **Family:** State
- **Scenario:** An agent is decorated `@Compaction('token-budget', { keepTokens: 8000 })` AND the builder also calls `.compaction('token-budget', { keepTokens: 2000 })`. `build()` reads "decorator OR builder override OR default" but never says which wins.
- **Impact:** Silent ambiguity — a consumer cannot predict which `keepTokens` takes effect; non-deterministic API surface.
- **Suggested fix:** Specify (mirroring `AgentRunnerBuilder.reflection()`'s `this.reflectionOverride ?? walk-based` precedent): **the builder `.compaction()` override wins over the `@Compaction` decorator**; add T3.1 test `test_builder_compaction_overrides_decorator`.

## SHOULD TEST

### EC-2: `'token-budget'` resolved WITHOUT `keepTokens` silently degrades to turn-count
- **Affected task:** T1.1
- **Family:** Input
- **Scenario:** `resolveCompactionStrategy('token-budget', {})` (or `@Compaction('token-budget')` with no opts). `compact()` forwards `keepTokens: undefined` to `compactTranscript`, which then falls back to its `keepRecent` (turn-count) default — so the strategy named "token-budget" silently does turn-count compaction.
- **Suggested test:** `test_token_budget_requires_keepTokens` — assert `compactionStrategyConfigSchema` (zod `.refine` / discriminated) REQUIRES `keepTokens` when `name === 'token-budget'`, throwing a typed error otherwise (fail-fast, not silent degradation — G10). Resolves the Unresolved Question's sibling ambiguity.

### EC-3: empty / single-message transcript
- **Affected task:** T1.1
- **Family:** Boundary
- **Scenario:** `compact([], { keepTokens: 8000, summarize })` or a 1-message transcript below budget.
- **Suggested test:** `test_compact_empty_and_below_budget_passthrough` — assert `compact([])` resolves to `[]` and a below-budget transcript returns unchanged (delegation to `compactTranscript`, which never mutates and no-ops below budget per its contract).

### EC-4: `runner.compaction` is `undefined` when unset → calling `.compact()` throws TypeError
- **Affected task:** T3.1
- **Family:** Integration
- **Scenario:** Per the Unresolved Question's leaning (compaction opt-in, default `undefined`), an agent with neither `@Compaction` nor `.compaction()` exposes `runner.compaction === undefined`. App code that does `runner.compaction.compact(...)` without a null-check throws `TypeError: Cannot read properties of undefined`.
- **Suggested test:** `test_runner_compaction_undefined_when_unset` — assert `runner.compaction === undefined` for a bare agent; document on the field's JSDoc that it is optional and the app MUST null-check (G10 — explicit contract, not a surprise).

### EC-5: invalid `@Compaction` name fails at `build()`, not at decoration
- **Affected task:** T2.1 / T3.1
- **Family:** Format
- **Scenario:** `@Compaction('toke-budget' /* typo */)` stores config (the decorator does not resolve); the error surfaces only at `build()` when `resolveCompactionStrategy` parses the name against its zod enum.
- **Suggested test:** `test_unknown_compaction_name_throws_typed_error_at_build` — assert a typed (zod) throw with a message naming the bad value (mirrors `resolveLoopStrategy`'s enum parse). Acceptable to fail at build (not decoration) as long as the error is typed and clear.

## DOCUMENT

### EC-6: `CompressibleMessage` union does not name richer roles (e.g. `'tool'`)
- **Affected task:** T1.1
- **Accepted risk:** Consumers whose transcript rows carry roles outside the SDK's `CompressibleMessage` union (e.g. theocode's `'tool'`) must cast at the call site — exactly as `theocode/server/lib/compaction.ts` does today (`messages as CompressibleMessage[]`). V4-F types the framework surface to the SDK's own type; widening it is out of scope (and would be a lie about what the SDK accepts). Document on `compact()`'s JSDoc.

### EC-7: SDK bump (T0.1) may pull transitive-dependency updates
- **Affected task:** T0.1
- **Accepted risk:** `pnpm update @theokit/sdk` to 2.9.0 may also refresh transitive deps in the lockfile. The Phase 0 DoD already runs BOTH `@theokit/agents` AND `theokit` suites as the regression gate; `/deps-audit` scans the result. If a transitive update introduces a CVE/regression, the gate catches it. No additional plan change needed.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T0.1 | 1 | 0 | 0 | 1 |
| T1.1 | 3 | 0 | 2 | 1 |
| T2.1 | 1 | 0 | 1 (shared w/ T3.1) | 0 |
| T3.1 | 2 | 1 | 1 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT

Absorb EC-1 (MUST FIX — precedence) into T3.1 and fold EC-2/EC-3/EC-4/EC-5 as named tests into the respective tasks' TDD; add EC-6/EC-7 as JSDoc/notes. EC-2 also resolves the plan's Unresolved Question (require `keepTokens` for `'token-budget'` → fail-fast). All fixes are ≤ 1 sentence or a single named test — no new module, no abstraction.
