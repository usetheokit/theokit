---
slug: v4d-react-loop-terminals
milestone_id: V4-D
created_at: 2026-06-23
goal: Add no_progress + step_limit terminals to @theokit/agents LoopStrategy
---

# Plan: V4-D react-loop terminals — `no_progress` + `step_limit`

> **v1.1 (2026-06-23):** absorbed edge-case MUST-FIX EC-1 (no_progress only on `tool-calls` rounds — empty already `stop`) + EC-2 (K=2 terminates at round 3) + EC-3 (order-independence test) + EC-4 (precedence: no_progress before ceiling).

## Goal

> "Enable `@theokit/agents` react/plan-act-reflect loops to stop on a stuck or ceiling-bound round instead of silently burning `maxIterations`, measured by `pnpm --filter @theokit/agents test` passing the new tests `test_loop_terminates_on_no_progress` and `test_loop_step_limit_finish_reason`."

## Context

`@theokit/agents@0.6.0` (slice `v4-mainloop-reflective-runtime`, V4-B/V4-C) shipped the react multi-round foundation: `resolveLoopStrategy('react')`, the `maxIterations` ceiling, and `runReflectiveLoop`. The V4-D milestone (ROADMAP-v4) is closed by two loop terminals the foundation lacks, identified by the blueprint `v4d-react-loop-terminals` (SHIPPABLE 98.5):

1. **`step_limit`** — today the loop stops when `round >= maxIterations` but the result does not say *why* it stopped (it is indistinguishable from a natural `stop`). opencode surfaces this and degrades gracefully (`opencode/.../session/runner/llm.ts:193,202,205` + `max-steps.ts`).
2. **`no_progress`** — today a stuck agent (repeating the same tool call, or empty rounds) burns the full `maxIterations`. Neither codex nor opencode detects this (opencode `llm.ts:51` lists it as an unimplemented TODO); it is a theokit value-add derived from the theocode `classifyRoundOutcome` spec (ROADMAP-v3 § V3-4).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC | Last commit | Why it exists |
|---|---|---|---|
| `packages/agents/src/loop/loop-strategy.ts` | 79 | `44fe692` 2026-06-23 | Defines `LoopFinishReason` (`:19`), `LoopOutcome`, `LoopStrategy`, `resolveLoopStrategy` |
| `packages/agents/src/loop/run-reflective-loop.ts` | 209 | `b6a7f05` 2026-06-23 | The multi-round driver; `deriveFinishReason` (`:82`), main loop (`:145-208`) |
| `packages/agents/src/bridge/delegation-types.ts` | ~30 | `157c2fd` 2026-06-23 | `DelegationResult` (the loop's return value: `response/toolCalls/cost/tokens/rounds`) |
| `packages/agents/tests/unit/main-loop-runtime.test.ts` | ~320 | `b6a7f05` 2026-06-23 | Unit tests for the loop/strategy contract |
| `packages/agents/tests/integration/reflective-loop-wiring.test.ts` | ~180 | `b6a7f05` 2026-06-23 | End-to-end loop wiring tests (both on-ramps) |

### Current callers / dependents

- `LoopFinishReason` (`loop-strategy.ts:19`) — consumed by: `loop-strategy.ts` (`LoopOutcome.finishReason`), `run-reflective-loop.ts:23,60,87` (`RoundResult.finishReason`, `deriveFinishReason`), `reflection-strategy.ts` (`ladderReflectionStrategy.reflect` inspects `outcome.finishReason`), `loop/index.ts:13` (barrel re-export).
- `LoopOutcome.finishReason` consumers (grep): `run-reflective-loop.ts`, `reflection-strategy.ts`, `loop-strategy.ts` only — all in-package, no cross-package consumer.
- `DelegationResult` — returned by `runReflectiveLoop` + `delegate()` + `AgentRunner.run()`; the new optional `finishReason` field is additive (no existing consumer reads it).
- Loop termination today: `run-reflective-loop.ts` `while` loop ends via `!(reflectionResult.continue && loop.shouldContinue(outcome))`; the ceiling lives in `loop.shouldContinue` (`loop-strategy.ts:77`: `finishReason === 'tool-calls' && round < maxIterations`).

### Domain glossary

- **LoopFinishReason** — why a single round ended (`tool-calls`/`stop`/`length`/`error` today).
- **step_limit** — the loop stopped because `round >= maxIterations`, not because the agent finished.
- **no_progress** — the agent made no new progress (same tool-call set + same/empty text) across K consecutive rounds.
- **graceful degradation** — at the step limit, instruct a tools-off text summary instead of truncating (opencode `MAX_STEPS_PROMPT`).
- **round signature** — the tuple `(sorted tool-call names+inputs, responseText)` used to compare consecutive rounds.

### Architecture boundaries affected

Entirely inside `packages/agents/src/loop/` + `bridge/delegation-types.ts`. No `@theokit/sdk` change (G2 — SDK is the only runtime; the loop is the bridge's outer loop). No new cross-package edge (G1). No new dependency.

## Prior Art & Related Work

- **Blueprint `v4d-react-loop-terminals`** (`knowledge-base/discoveries/blueprints/v4d-react-loop-terminals-blueprint.md`, SHIPPABLE 98.5) — codex `tasks/regular.rs:73` (queue-drain, no no_progress); opencode `llm.ts:193,202` (step_limit graceful degradation) + `:51` (no_progress unimplemented TODO).
- **Blueprint `declarative-agent-orchestration`** (SHIPPABLE 99) — the foundation (stopWhen/maxSteps) shipped in 0.6.0.
- **theocode `classifyRoundOutcome` spec** — ROADMAP-v3 § V3-4 (prose; code deleted) — the `done`/`step_limit`/`no_progress` terminal taxonomy.

## Objective

Extend `LoopFinishReason` with `step_limit` + `no_progress`, detect both in `runReflectiveLoop`, surface the terminal reason on `DelegationResult.finishReason`, and add a final-round graceful-degradation prompt hint for `step_limit` — all inside `packages/agents`, zero new deps, zero SDK change.

## ADRs

### D1 — `step_limit` surfaces the terminal reason + graceful degradation via a final-round prompt hint

**Decision:** when `runReflectiveLoop` stops because the ceiling was hit (the round wanted to continue — `finishReason === 'tool-calls'` — but `round >= maxIterations`), set `acc.finishReason = 'step_limit'`. On the final allowed round, prepend a "final round — summarize, no further tools" instruction to the prompt (modeled on opencode's `MAX_STEPS_PROMPT`).

**Rationale:** opencode is SOTA here (blueprint D2) — a hard truncation wastes the work; a forced summary is strictly more useful, and `step_limit` makes "ran out of steps" observable. theokit cannot force `toolChoice:none` (that is an SDK concern, G2), so the degradation is a *prompt hint* — the honest in-scope mechanism.

**Alternatives considered:** (a) plain terminal, no summary hint — rejected, worse UX, loses the opencode lesson; (b) force tools-off in the SDK — rejected, violates G2 (no SDK reimplementation).

### D2 — `no_progress` is a first-principles detector (derived, not copied)

**Decision:** the detector runs ONLY on rounds that would otherwise continue (`r.finishReason === 'tool-calls'`); a `stop`/`error`/`length`/empty round already terminates with its own reason (EC-1 — an empty round is `stop`, NOT no_progress). Track the prior would-continue round's signature `(sorted tool-call names+inputs, responseText)`. If the current signature equals the prior's, increment a `stuck` counter (else reset to 0); terminate with `acc.finishReason = 'no_progress'` when `stuck >= 2` — i.e. on the **2nd consecutive repeat** (round 3 for an all-identical stream; K=2 tolerates exactly one retry). The no_progress terminal is evaluated BEFORE the `loop.shouldContinue` ceiling (EC-4 — the earlier, more-informative signal wins; if `maxIterations < 3` the ceiling fires first, which is correct).

**Rationale:** blueprint Q3 verdict — neither codex nor opencode implements no-progress (opencode `llm.ts:51` is an unchecked TODO). Claiming a reference would be a fabricated citation. The detector derives from the theocode `classifyRoundOutcome` spec + first principles; correctness is owned by tests, not a port. Scoping to `tool-calls` rounds avoids double-defining the empty round (which EC-1 already terminates as `stop`).

**Alternatives considered:** (a) skip no_progress — rejected, it is the V4-D budget-protection value-add; (b) K=1 (terminate on first repeat) — rejected, a single legitimate retry would false-positive; K=2 tolerates one retry. (c) hash the full transcript — rejected, the round signature is sufficient + cheaper.

### D3 — No `@theokit/sdk` change; no new dependency (V3-4 stays app-policy)

**Decision:** both terminals live in `packages/agents/src/loop/` + the additive `DelegationResult.finishReason` field. No SDK edit, no dep.

**Rationale:** blueprint D3 + ROADMAP-v3 § V3-4 ("may stay app-policy"); Q5 confirmed theokit owns its loop primitive (like codex/opencode). KISS + YAGNI: the terminals are pure loop logic.

**Alternatives considered:** build the V3-4 SDK continuation driver first — rejected, V3-4 is not a blocker and may never be built.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `no_progress` false-positive: a legitimately slow agent repeating a read on the same file gets killed early | MEDIUM | K=2 consecutive (tolerates one retry); signature includes tool *inputs* so a different arg = progress; documented + unit-tested for the "different input = progress" case | implementer |
| `step_limit` prompt hint ignored by the model (it still tries a tool) | LOW | The hint is best-effort (theokit can't force tools-off per G2); `step_limit` is still surfaced on the result regardless of whether the model complies — observability holds | implementer |
| Adding enum values breaks an exhaustive `switch` on `LoopFinishReason` somewhere | LOW | Baseline grep shows the only consumers are in-package (`reflection-strategy.ts` uses an `if finishReason==='tool-calls'` check, not exhaustive switch) — additive values are safe; typecheck verifies | implementer |

## Unresolved Questions

(none — every decision is resolved at plan time. K=2 and the round-signature shape are fixed in D2; the graceful-degradation mechanism is fixed in D1.)

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `zod` | `^4.0.0` | npm | already the SSoT for `loopStrategyConfigSchema` (no schema change needed — `LoopFinishReason` is a TS union, not Zod-validated input) |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | The terminals are pure in-house loop logic; no library solves "compare two rounds" better than 5 lines (KISS) | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Dependency Graph

```
Phase 1 (enum + step_limit)  ──▶  Phase 2 (no_progress)  ──▶  Phase 3 (Integration Validation)
   T1.1 enum + result field
   T1.2 step_limit + graceful hint
                                      T2.1 no_progress detector
```

Phase 2 depends on Phase 1 (the `LoopFinishReason` enum + `DelegationResult.finishReason` field must exist first). Phase 3 depends on both.

## Phase 1: Enum + step_limit

### T1.1 — Extend `LoopFinishReason` + add `DelegationResult.finishReason`

#### Objective
Add `'step_limit'` and `'no_progress'` to `LoopFinishReason`; add optional `finishReason?: LoopFinishReason` to `DelegationResult`.

#### Why this step (action + reasoning)
Action: widen the union (`loop-strategy.ts:19`) and the result type (`delegation-types.ts`). Reasoning: both terminals need new enum values and an observable field to surface the terminal reason; this is the type foundation Phase 1/2 logic builds on (Baseline: the only consumers are in-package, so additive values are safe — Drawback row 3).

#### Evidence
`loop-strategy.ts:19` `LoopFinishReason = 'tool-calls' | 'stop' | 'length' | 'error'`; `DelegationResult` in `delegation-types.ts` has no `finishReason` field today.

#### Files to edit
- `packages/agents/src/loop/loop-strategy.ts` — extend `LoopFinishReason` union.
- `packages/agents/src/bridge/delegation-types.ts` — add `readonly finishReason?: LoopFinishReason` (import the type from `../loop/loop-strategy.js`).
- `packages/agents/tests/unit/main-loop-runtime.test.ts` — RED test asserting the new union members are assignable + `DelegationResult.finishReason` typed.

#### Deep file dependency analysis
`LoopFinishReason` is re-exported via `loop/index.ts:13`. `delegation-types.ts` importing from `loop/loop-strategy.js` does NOT create a cycle (loop-strategy imports nothing from bridge; verified G1 madge clean in 0.6.0). `reflection-strategy.ts` uses `if (outcome.finishReason === 'tool-calls')` (not an exhaustive switch) — additive values need no change there.

#### TDD
```
test_loop_finish_reason_includes_new_terminals — a value 'step_limit' and 'no_progress' are assignable to LoopFinishReason (expectTypeOf / runtime const). RED: today the union rejects them.
test_delegation_result_carries_finish_reason — a DelegationResult with finishReason:'step_limit' typechecks. RED: field absent today.
```

#### Concurrency tests (only when applicable)
(none — single-threaded). Pure type/enum change — no shared state, no async control flow added.

#### Acceptance Criteria
- `test_loop_finish_reason_includes_new_terminals` passes: `'step_limit'` and `'no_progress'` are assignable to `LoopFinishReason`.
- `test_delegation_result_carries_finish_reason` passes: a `DelegationResult` with `finishReason:'step_limit'` typechecks and the field is re-exported via `loop/index.ts`.
- `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exits 0.

#### DoD (Definition of Done)
- `pnpm --filter @theokit/agents test` green; `npx eslint packages/agents/src/loop/loop-strategy.ts packages/agents/src/bridge/delegation-types.ts --max-warnings=0` clean.

### T1.2 — Detect `step_limit` + graceful final-round prompt hint in `runReflectiveLoop`

#### Objective
When the loop stops because `round >= maxIterations` while the round still wanted to continue, set `acc.finishReason = 'step_limit'`; on the final allowed round, prepend a summary instruction to the prompt.

#### Why this step (action + reasoning)
Action: in `run-reflective-loop.ts`, after the terminal decision, distinguish ceiling-stop from natural stop and set the result reason; compute `isFinalRound = round === loop.maxIterations` before building the prompt and prepend a tools-off summary hint. Reasoning: opencode's graceful degradation (blueprint D1/Q1, `llm.ts:202`) makes the step-limit produce a useful answer + observable reason; theokit's in-scope mechanism is a prompt hint (G2 — can't force tools-off in the SDK).

#### Evidence
`run-reflective-loop.ts:145-208` main loop; ceiling is in `loop.shouldContinue` (`loop-strategy.ts:77`). opencode `llm.ts:193` `isLastStep = currentStep >= agent.info.steps`, `:202` injects `MAX_STEPS_PROMPT`.

#### Files to edit
- `packages/agents/src/loop/run-reflective-loop.ts` — final-round detection, prompt hint, `acc.finishReason = 'step_limit'`.
- `packages/agents/tests/unit/main-loop-runtime.test.ts` — RED tests for step_limit reason + final-round hint.

#### Deep file dependency analysis
The loop already sets `acc.rounds`; adding `acc.finishReason` is parallel. The prompt is built at the top of the `while` body (`:165` today: `round === 1 || !feedback ? message : ...`). The final-round hint composes with the existing reflection-feedback prepend (order: final-hint + feedback). No new branch in `loop.shouldContinue`.

#### TDD
```
test_loop_step_limit_finish_reason — react loop, factory always emits tool_result (never stops), maxIterations=2 ⇒ result.finishReason === 'step_limit' AND prompts.length === 2.
test_loop_final_round_prompt_carries_summary_hint — same setup; prompts[last] contains a 'final'/'summariz' instruction (the graceful hint).
test_loop_natural_stop_is_not_step_limit — factory stops on round 1 (pure done) ⇒ result.finishReason === 'stop' (NOT step_limit).
```

#### Concurrency tests (only when applicable)
(none — single-threaded). Abort/cancellation propagation is unchanged and already covered by `test_loop_propagates_abort_signal`.

#### Acceptance Criteria
- `test_loop_step_limit_finish_reason` passes: a never-stopping stream at `maxIterations=2` returns `finishReason === 'step_limit'` with `prompts.length === 2`.
- `test_loop_natural_stop_is_not_step_limit` passes: a round-1 pure-`done` stream returns `finishReason === 'stop'`.
- `test_loop_final_round_prompt_carries_summary_hint` passes: `prompts[last]` contains the summary instruction and `prompts[0]` (non-final) does not.

#### DoD
- 3 new tests green; full `pnpm --filter @theokit/agents test` green; lint clean.

## Phase 2: no_progress

### T2.1 — `no_progress` detector in `runReflectiveLoop`

#### Objective
Terminate with `finishReason = 'no_progress'` when the round signature is unchanged-or-empty for K=2 consecutive rounds.

#### Why this step (action + reasoning)
Action: compute a `roundSignature(toolCalls, responseText)`; keep `prevSignature` + `stuckCount`; if current equals prev OR the round is empty, increment, else reset; at `stuckCount >= 2` terminate. Reasoning: blueprint D2 — a stuck agent burns budget; neither reference detects it, so theokit derives it from first principles (K=2 tolerates one legitimate retry; signature includes tool inputs so a different arg counts as progress — Drawback row 1).

#### Evidence
Blueprint Q3 verdict (no reference detector); opencode `llm.ts:51 [ ]` TODO; theocode `classifyRoundOutcome` spec (ROADMAP-v3 § V3-4).

#### Files to edit
- `packages/agents/src/loop/run-reflective-loop.ts` — signature helper + stuck counter + terminal.
- `packages/agents/tests/unit/main-loop-runtime.test.ts` — RED tests for no_progress.

#### Deep file dependency analysis
The detector reads each round's `r.toolCalls` + `r.responseText` (already accumulated). The signature helper is a pure private function (SRP). Terminates BEFORE `loop.shouldContinue` re-entry, so it composes with the existing ceiling without changing `loop-strategy.ts`.

#### Pseudo-code / Signatures
```ts
function roundSignature(toolCalls: {name:string;input:unknown}[], text: string): string
// JSON of sorted [name+JSON(input)] + '|' + text. Sorted ⇒ tool-call ORDER independent (EC-3).
// in loop, AFTER deriving r.finishReason, ONLY when r.finishReason === 'tool-calls' (EC-1):
//   const sig = roundSignature(r.toolCalls, r.responseText)
//   if (sig === prevSig) stuck++; else stuck = 0
//   if (stuck >= 2) { acc.finishReason = 'no_progress'; acc.rounds = round; return acc }  // EC-4: before the ceiling
//   prevSig = sig
// (stop/error/length/empty rounds skip this — they already terminate with their own reason)
```

#### TDD
```
test_loop_terminates_on_no_progress — factory emits the SAME tool_result (finishReason 'tool-calls') every round; react maxIterations=8 ⇒ result.finishReason === 'no_progress' AND rounds === 3 (K=2 = 2nd consecutive repeat), NOT 8 (EC-2).
test_loop_empty_round_terminates_as_stop_not_no_progress — factory emits [] on round 1 ⇒ finishReason === 'stop' at round 1 (EC-1: empty is stop, no_progress NOT triggered).
test_loop_different_tool_input_is_progress — round1 read{a}, round2 read{b}, round3 done ⇒ runs to natural stop (NOT no_progress — different input resets stuck).
test_loop_signature_is_tool_order_independent — round1 [read{a},write{b}], round2 [write{b},read{a}], round3 same ⇒ no_progress at round 3 (EC-3: sorted signature = order-independent).
```

#### Concurrency tests (only when applicable)
(none — single-threaded). The `stuck` counter + `prevSig` are loop-local state; no shared mutation, no async beyond the existing per-round `await`.

#### Acceptance Criteria
- `test_loop_terminates_on_no_progress` passes: an all-identical `tool-calls` stream returns `finishReason === 'no_progress'` with `rounds === 3` (K=2).
- `test_loop_different_tool_input_is_progress` passes: distinct tool inputs across rounds run to natural `stop` (counter resets, no `no_progress`).
- `test_loop_empty_round_terminates_as_stop_not_no_progress` passes: an empty round returns `finishReason === 'stop'` at round 1.

#### DoD
- 3 new tests green; full suite green; lint + typecheck clean.

## Coverage Matrix

| Requirement (from Goal / blueprint) | Task(s) |
|---|---|
| `step_limit` enum value + observable on result | T1.1, T1.2 |
| `step_limit` graceful degradation (final-round summary hint) | T1.2 |
| `no_progress` enum value | T1.1 |
| `no_progress` detector (K=2, signature compare, empty round) | T2.1 |
| No new dep / no SDK change | T1.1, T1.2, T2.1 (all in `packages/agents`) |
| Integration: both terminals fire end-to-end | Phase 3 |

100% — every Goal/blueprint requirement maps to ≥ 1 task.

## Failure scenarios (when I/O external)

The loop's only external boundary is the injected SDK stream factory. A factory/stream exception mid-round is **already** handled (M2, `b6a7f05`): `consumeOneRound` is wrapped in try/catch re-throwing typed `DelegationError`. The new terminals add no new external I/O — they are pure post-round logic over already-consumed events. `(no new external I/O — SDK stream boundary unchanged and already covered by the M2 typed-error path.)`

## Global Definition of Done

- [ ] All tasks `committed`; all DoD checkboxes true.
- [ ] `pnpm --filter @theokit/agents test` green (incl. 10 new unit tests + 2 integration tests).
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` clean.
- [ ] `npx eslint packages/agents/src --max-warnings=0` clean.
- [ ] `npx madge --circular --extensions ts packages/agents/src` → no cycles (G1).
- [ ] G2 grep (no LLM fetch) clean.
- [ ] File-size budget: each touched file < 500 LoC (run-reflective-loop.ts ~209 + ~40 ≈ 250, well under).
- [ ] CHANGELOG `[Unreleased]` updated.
- [ ] Plan archived after `/review` READY_TO_MERGE + merge.

## Final Phase: Integration Validation (MANDATORY)

### Execution
- Add to `packages/agents/tests/integration/reflective-loop-wiring.test.ts`: a `no_progress` end-to-end test (decorated `@MainLoop({strategy:'react'})` agent + a mock SDK stream repeating an identical `tool_result` (finishReason 'tool-calls') → assert `delegate()` result `finishReason === 'no_progress'` and `rounds === 3` (K=2 = 2nd repeat, EC-2)) AND a `step_limit` end-to-end test (never-stopping stream → `finishReason === 'step_limit'`, `rounds === maxIterations`), both on-ramps (delegate + AgentRunner) for on-ramp parity.
- Run `pnpm --filter @theokit/agents test`, `tsc --noEmit`, `eslint`, `madge --circular`, G2 grep.

### Acceptance Criteria
- `test_no_progress_via_delegate_and_runner` passes: both on-ramps return `DelegationResult.finishReason === 'no_progress'` with `rounds === 3`.
- `test_step_limit_via_delegate_and_runner` passes: both on-ramps return `finishReason === 'step_limit'` with `rounds === maxIterations` (on-ramp parity — identical terminal reason).
- `pnpm --filter @theokit/agents test` exits 0; `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exits 0; `npx madge --circular --extensions ts packages/agents/src` prints "No circular dependency found!".

### If Validation Fails
Return to the failing task; do NOT emit `IMPLEMENTATION_COMPLETE` until the gate passes (cycle-implement validation halt-loop).
