# Edge Case Review — V4-L.2 runner run-options

Date: 2026-06-25
Tasks analyzed: 3 (T1.1, T2.1, T2.2)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

(none — the three overrides reuse proven seams: model via the existing `envModel ?? compiled.model ?? default` precedence, maxIterations via the zod-validated `resolveLoopStrategy`, cwd via the SDK's documented `LocalOptions.cwd`. The invalid-maxIterations fail-fast is already a planned task, T2.2.)

## SHOULD TEST

### EC-1: V4-J `tools` + V4-L.2 `model`/`cwd`/`maxIterations` compose in one call
- **Affected task:** T2.1
- **Family:** Integration
- **Scenario:** All four per-request overrides live on the same `AgentRunnerRunOptions`; a real caller (theocode) passes several at once. A regression could let one override clobber another (e.g., the loop override path dropping the tools override).
- **Suggested test:** `test_v4j_tools_and_v4l2_overrides_compose()` — one `run(..., { apiKey, tools, model, cwd, maxIterations })` call: assert the captured `Agent.create` got the override model + cwd AND the override tools, and the loop honored the ceiling.

### EC-2: `maxIterations` override on a `simple-chat` agent stays single-round (no-op by design)
- **Affected task:** T2.1
- **Family:** State
- **Scenario:** `resolveLoopStrategy('simple-chat', N)` returns `shouldContinue: () => false` regardless of N, so a `maxIterations` override on a one-shot agent must NOT suddenly make it multi-round.
- **Suggested test:** `test_maxIterations_override_noop_on_simple_chat()` — a simple-chat agent with `{ maxIterations: 5 }` still runs exactly 1 round.

## DOCUMENT

### EC-3: empty-string `model`/`cwd` pass through (`??` / `!== undefined` semantics)
- **Accepted risk:** `opts.model ?? compiled.model` treats `''` as a deliberate value (only null/undefined fall through), and `cwd !== undefined` sets `local.cwd = ''`. An empty string is an app misuse, not a framework concern — the SDK surfaces the resulting error (fail-loud). The resolver's existing `if (!cwd)` already treats `''` as "no cwd". No special-casing (KISS — second-guessing `''` would be surprising).

### EC-4: SDK `LocalOptions.cwd` is `string | string[]` but the run-option exposes `string`
- **Accepted risk:** Single-root cwd is the documented need (theocode passes one project root). Multi-root (`string[]`) is YAGNI — already recorded in the plan's Drawbacks. A future slice widens it if a real multi-root case appears.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 2 | 0 | 0 | 2 (EC-3, EC-4) |
| T2.1 | 2 | 0 | 2 (EC-1, EC-2) | 0 |
| T2.2 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (2 SHOULD TEST items to absorb into T2.1; EC-3/EC-4 documented — no plan-blocking changes)
