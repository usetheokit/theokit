---
slug: v4o-rich-usage-passthrough
milestone_id: V4-O
created_at: 2026-06-26
goal: Forward the SDK reasoning/cache token buckets through the adapter done event and DelegationResult so a consumer keeps full per-turn usage.
---

# Plan: V4-O — forward reasoning/cache token buckets on `done` + `DelegationResult`

> **Version 1.0** — V4-N.1 made the adapter emit real `inputTokens`/`outputTokens`/`totalTokens` + `cost` on the `done` event, but the SDK `RunResult.usage` (`TokenUsage`) also carries `reasoningTokens`/`cacheReadTokens`/`cacheWriteTokens`, which the adapter drops. A consumer that tracks per-turn reasoning/cache usage (theocode's `LlmUsage`) regresses those buckets to 0 when it adopts `AgentRunner.stream()`, with no app-side fix (the data is discarded at the adapter). V4-O forwards the three buckets end-to-end: `realUsageDone` reads them from `RunResult.usage`, the loop accumulates them across rounds, and `DelegationResult` carries them. Additive to the event contract; reuses the SDK `RunResult.usage` already read by `run.wait()` (Rule 9); no new dependency.

## Goal

> "Enable `createSdkAgentStream` + the reflective loop to forward the SDK `reasoningTokens`/`cacheReadTokens`/`cacheWriteTokens` so that the loop's `DelegationResult` carries those buckets, measured by `npx vitest run packages/agents/tests/integration/adapter-real-usage.test.ts` passing (the `done` event and `DelegationResult` carry the three buckets from `run.wait().usage`)."

## Context

The V4-O discover (`knowledge-base/discoveries/blueprints/agentrunner-loop-adoption-blueprint.md` — recorded in the theocode repo) found that `realUsageDone` (`sdk-adapter.ts`) reads `RunResult.usage` but forwards only `{ inputTokens, outputTokens, totalTokens }`, dropping `reasoningTokens`/`cacheReadTokens`/`cacheWriteTokens`. A consumer adopting `AgentRunner.stream()` (theocode's loop collapse) loses those buckets with no app-side remedy. The SDK `TokenUsage` (`run-D22b53SU.d.ts:571`) declares all three as optional readonly numbers, so forwarding them is a pure passthrough.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/bridge/sdk-adapter.ts` | ~265 | `b587836` (2026-06-25) | `createSdkAgentStream` + `realUsageDone` build the real-usage `done` | exactly ONE terminal per round; SDK is the only runtime (G2); V4-N.1 behavior unchanged |
| `packages/agents/src/loop/run-reflective-loop.ts` | ~436 | `7753e3d` (2026-06-25) | `applyDone` folds the `done` usage into the round; the loop accumulates into `DelegationResult` | exactly-one-terminal; V4-N split-usage accumulation unchanged |
| `packages/agents/src/bridge/delegation-types.ts` | ~55 | (V4-N) | `DelegationResult` shape (carries split usage) | existing fields unchanged; new fields optional |
| `packages/agents/src/bridge/agent-stream-events.ts` | ~155 | (M-series) | typed `DoneEvent` public contract | `usage` shape stays additive (new fields optional) |
| `packages/agents/tests/integration/adapter-real-usage.test.ts` | ~106 | `b587836` | asserts real usage on `done` + `DelegationResult` | extend with the three buckets |
| `packages/agents/tests/unit/loop-outcome-fidelity.test.ts` | — | (V4-N) | asserts loop folds usage | extend with bucket accumulation |

### Current callers / dependents

- **Symbol:** `realUsageDone` (`sdk-adapter.ts`) — builds the `done` event consumed by the loop's `applyDone`. The change adds three optional fields to the `done.usage`.
- **Symbol:** `applyDone` (`run-reflective-loop.ts`) — reads `event.usage` into the round; the loop accumulates into `acc` (`DelegationResult`). The change folds the three buckets.
- **Symbol:** `DelegationResult` (`delegation-types.ts`) — consumed by `AgentRunner.run`/`stream`, `delegate()`, and downstream consumers. The change adds three optional fields (backward-compatible).
- **SDK:** `RunResult.usage?: TokenUsage` with `reasoningTokens?`/`cacheReadTokens?`/`cacheWriteTokens?` (`run-D22b53SU.d.ts:571-576`).

### Domain glossary

- **reasoning/cache buckets** — `reasoningTokens` (model thinking tokens), `cacheReadTokens`/`cacheWriteTokens` (prompt-cache hits/writes); optional on `TokenUsage`, absent when the provider omits them.
- **passthrough** — the adapter copies the buckets from `RunResult.usage` into the `done.usage` without computing anything (the SDK owns the numbers).

### Architecture boundaries affected

- None new — same SDK `RunResult.usage` already read by V4-N.1's `run.wait()`. SDK stays the only runtime (G2); no dependency change (G1).

## Prior Art & Related Work

- **Internal precedent** — V4-N.1 (`knowledge-base/plans/v4n1-adapter-real-usage-plan.md`) established the `realUsageDone` + loop-accumulation + `DelegationResult` pattern; V4-O extends the same three sites additively.
- **In-repo consumer** — theocode `server/lib/sdk-mappers.ts` `usageToTokens` maps the SDK `TokenUsage` reasoning/cache buckets into its `LlmUsage`; V4-O preserves that data through the framework loop.
- **SDK contract** — `TokenUsage` (`run-D22b53SU.d.ts:571`): the five-bucket usage surface.

## Objective

- [ ] `realUsageDone` forwards `reasoningTokens`/`cacheReadTokens`/`cacheWriteTokens` from `RunResult.usage` into the emitted `done.usage`.
- [ ] The loop's `applyDone` folds the three buckets into the round; the loop accumulates them across rounds into `DelegationResult`.
- [ ] `DelegationResult` carries `reasoningTokens?`/`cacheReadTokens?`/`cacheWriteTokens?` (accumulated; absent for the single-shot path).
- [ ] The typed `DoneEvent.usage` declares the three optional buckets (public-contract honesty — G10).
- [ ] Backward compatibility: same signatures; V4-N/V4-N.1 behavior unchanged; absent buckets default to 0.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | `>=2.9.0` (installed) | npm | `RunResult.usage.reasoningTokens`/`cacheReadTokens`/`cacheWriteTokens` — the documented per-run usage surface. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | | | | No dependency added — passthrough of existing SDK usage fields. |

### Removed

| Package | Last version | Why removed |
|---|---|---|

## ADRs

### D1 — Forward the three buckets as a pure passthrough on `done.usage`

- **Decision:** `realUsageDone` reads `result.usage.reasoningTokens`/`cacheReadTokens`/`cacheWriteTokens` (each `?? 0`) and includes them in the emitted `done.usage`; the loop folds them; `DelegationResult` accumulates them.
- **Rationale:** the buckets exist only on `RunResult.usage`; the adapter already reads it (V4-N.1). Forwarding at the adapter is the single right place (DRY) so no consumer re-reads the SDK.
- **Alternatives considered:** (a) Leave the buckets dropped + have consumers re-read `run.wait()` — REJECTED: every consumer re-implements the read; the adapter owns the run (DRY). (b) Pass the raw `TokenUsage` object through — REJECTED: leaks the SDK type across the bridge boundary; three named numbers keep the contract owned by `@theokit/agents`.
- **Consequences:** `done.usage` + `DelegationResult` carry three more numbers; absent buckets default to 0 (unchanged behavior for providers that omit them).

### D2 — `DelegationResult` buckets are optional (backward-compatible)

- **Decision:** the three new `DelegationResult` fields are optional (`reasoningTokens?` etc.), mirroring V4-N's `tokensInput?`/`tokensOutput?`; the single-shot `delegate()` path leaves them absent.
- **Rationale:** additive optional fields never break existing consumers (V4-N precedent). The loop sets them; non-loop paths omit them.
- **Alternatives considered:** (a) Required fields defaulting to 0 — REJECTED: forces every constructor of `DelegationResult` to set them, churning the single-shot path with no value.
- **Consequences:** consumers read `result.reasoningTokens ?? 0`; the loop populates them, the single-shot path does not.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Three more numbers threaded through the round accumulator | Low | Mechanical, mirrors V4-N's tokensInput/tokensOutput; the suite asserts accumulation | maintainer |
| Provider omits buckets (undefined) | Low | `?? 0` default at every read (same as inputTokens today) | maintainer |
| Typed `DoneEvent` drifts from the loose adapter `done` | Low | T1.1 updates both the typed event and the adapter emit in the same task | maintainer |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (adapter forward + loop fold + DelegationResult + typed DoneEvent) ──▶ Phase 2 (TDD proof: done buckets + DelegationResult accumulation)
                                                                                  │
                                                                                  ▼
                                                                         Final Phase: Integration Validation
```

## Phase 1: Forward the buckets

**Objective:** the adapter forwards reasoning/cache buckets; the loop folds + accumulates them; `DelegationResult` + typed `DoneEvent` declare them.

### T1.1 — Adapter forward + loop fold + types

#### Objective
`realUsageDone` includes the three buckets in `done.usage`; `applyDone` reads them; the loop accumulates into `acc`; `DelegationResult` + typed `DoneEvent.usage` declare the three optional fields.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — extends `realUsageDone` to copy `reasoningTokens`/`cacheReadTokens`/`cacheWriteTokens` (each `?? 0`) into `done.usage`; extends `RoundResult` + `applyDone` to fold them; extends the loop accumulation; adds the three optional fields to `DelegationResult` and the typed `DoneEvent.usage`.
2. **Why it is necessary now** — it is the fix (ADR D1); without it the buckets stay dropped and the theocode adoption regresses per-turn reasoning/cache visibility.

#### Evidence
`sdk-adapter.ts` `realUsageDone` (builds `done.usage` from `result.usage`); `run-reflective-loop.ts` `applyDone` (`:248-256`) + loop accumulation (`:372-377`); `delegation-types.ts` `DelegationResult` (`:14-29`); SDK `TokenUsage` (`run-D22b53SU.d.ts:571-576`).

#### Files to edit
```
packages/agents/src/bridge/sdk-adapter.ts — realUsageDone forwards 3 buckets; widen wait() usage type
packages/agents/src/loop/run-reflective-loop.ts — RoundResult + applyDone + acc accumulate 3 buckets
packages/agents/src/bridge/delegation-types.ts — DelegationResult += 3 optional buckets
packages/agents/src/bridge/agent-stream-events.ts — typed DoneEvent.usage += 3 optional buckets
```

#### Deep file dependency analysis
- `sdk-adapter.ts` — `realUsageDone(result, t0)` reads `result.usage`; widen its type with the three optional buckets; include them in `done.usage`. Downstream: `applyDone` reads them.
- `run-reflective-loop.ts` — `RoundResult` gains three numbers; `applyDone` reads `usage.reasoningTokens ?? 0` etc.; the loop adds them into `acc` (mirrors `tokensInput`).
- `delegation-types.ts` + `agent-stream-events.ts` — additive optional fields.

#### Deep Dives
- **Invariant:** exactly-one-terminal preserved (V4-N.1) — V4-O only enriches the `done` payload.
- **Edge case:** `result.usage` absent → all buckets 0 (defensive `?? 0`), unchanged.
- **Edge case:** a provider reports only some buckets → the others default 0.
- **DIP:** three named numbers cross the bridge, never the SDK `TokenUsage` type (D1 alt b).

#### Pseudo-code / Signatures
```ts
// realUsageDone done.usage:
usage: {
  inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
  reasoningTokens: u?.reasoningTokens ?? 0,
  cacheReadTokens: u?.cacheReadTokens ?? 0,
  cacheWriteTokens: u?.cacheWriteTokens ?? 0,
}
// applyDone: r.reasoningTokens = usage?.reasoningTokens ?? 0 (+ cacheRead/cacheWrite)
// loop: acc.reasoningTokens = (acc.reasoningTokens ?? 0) + r.reasoningTokens (+ cacheRead/cacheWrite)
```

#### Tasks
1. Widen the `wait()` usage type + forward the 3 buckets in `realUsageDone`.
2. Fold the 3 buckets in `RoundResult` + `applyDone` + loop accumulation.
3. Add the 3 optional fields to `DelegationResult` + typed `DoneEvent.usage`.
4. Run typecheck.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Types compile: `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Pass: complexity — `npx eslint packages/agents/src/bridge/sdk-adapter.ts packages/agents/src/loop/run-reflective-loop.ts --max-warnings=0`
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/adapter-real-usage.test.ts` ≥ 90% on changed files
- [ ] Pass: lint — `npx eslint packages/agents/src --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/src/bridge/sdk-adapter.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents/src --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

## Phase 2: TDD proof

**Objective:** tests prove the three buckets flow to the `done` event and accumulate into `DelegationResult`.

### T2.1 — Bucket flow + accumulation tests

#### Objective
Extend `adapter-real-usage.test.ts` to assert the emitted `done.usage` carries the three buckets; extend the loop unit test to assert `DelegationResult` accumulates them across rounds.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — adds RED assertions: a mock `run.wait()` returning `{ usage: { inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens } }` → the adapter `done` carries the buckets, and `AgentRunner.run` → `DelegationResult` carries them; a loop test sums two rounds' buckets.
2. **Why it is necessary now** — the buckets are the Goal's metric; without the test the passthrough is unproven.

#### Evidence
`adapter-real-usage.test.ts` (the V4-N.1 mock `run.wait()` returning usage); `loop-outcome-fidelity.test.ts` (the loop folds `done` usage).

#### Files to edit
```
packages/agents/tests/integration/adapter-real-usage.test.ts — assert done + DelegationResult carry 3 buckets
packages/agents/tests/unit/loop-outcome-fidelity.test.ts — assert DelegationResult accumulates buckets across rounds
```

#### Deep file dependency analysis
- `adapter-real-usage.test.ts` — the hoisted mock usage gains `reasoningTokens`/`cacheReadTokens`/`cacheWriteTokens`; new assertions on `done.usage` + `DelegationResult`.
- `loop-outcome-fidelity.test.ts` — a two-round fake stream factory whose `done` events carry buckets; assert `result.reasoningTokens` (etc.) is the sum.

#### Deep Dives
- **Assertion (adapter):** `done.usage.reasoningTokens === 3`, `cacheReadTokens === 5`, `cacheWriteTokens === 2`; via `AgentRunner.run`, `result.reasoningTokens === 3` (etc.).
- **Assertion (loop):** two rounds each `reasoningTokens: 3` → `result.reasoningTokens === 6`.
- **Default:** a round whose `done` omits buckets contributes 0.

#### Pseudo-code / Signatures
```ts
h.usage = { inputTokens: 12, outputTokens: 7, reasoningTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 2 }
const done = events.find((e) => e.type === 'done')
expect(done?.usage).toMatchObject({ reasoningTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 2 })
const result = await AgentRunner.builder(A).build().run('hi', { apiKey: 'k' })
expect(result.reasoningTokens).toBe(3)
```

#### Tasks
1. Extend the adapter test mock usage + assert buckets on `done` + `DelegationResult`.
2. Extend the loop test: two-round bucket accumulation.
3. Run the suite.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Buckets flow: `npx vitest run packages/agents/tests/integration/adapter-real-usage.test.ts`
- [ ] Accumulation: `npx vitest run packages/agents/tests/unit/loop-outcome-fidelity.test.ts`
- [ ] Pass: complexity — `npx eslint packages/agents/tests/integration/adapter-real-usage.test.ts packages/agents/tests/unit/loop-outcome-fidelity.test.ts --max-warnings=0`
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/adapter-real-usage.test.ts` exercises the bucket path
- [ ] Pass: lint — `npx eslint packages/agents/tests --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/tests/integration/adapter-real-usage.test.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| G1 | adapter drops reasoning/cache buckets | T1.1, T2.1 | `realUsageDone` forwards the 3 buckets (ADR D1) |
| G2 | loop does not fold the buckets | T1.1, T2.1 | `applyDone` + loop accumulation fold them |
| G3 | DelegationResult lacks the buckets | T1.1, T2.1 | 3 optional fields added (ADR D2) |
| G4 | typed DoneEvent contract drifts | T1.1 | typed `DoneEvent.usage` declares the 3 optional buckets |
| G5 | no proof buckets reach DelegationResult | T2.1 | end-to-end + loop accumulation tests |
| G6 | backward compat (signatures, V4-N/N.1) | T1.1, T2.1 | additive optional fields; full suite green |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `rules/architecture.md` / G6)
- [ ] CHANGELOG.md updated — add a changeset (minor bump `@theokit/agents`)
- [ ] Backward compatibility preserved (same signatures; additive optional fields)
- [ ] Plan-specific: `npx vitest run packages/agents/tests/integration/adapter-real-usage.test.ts` passes (the Goal metric)
- [ ] **Runtime-metric proof** — n/a (no new counter)
- [ ] **Plan archived** — after `/review` READY_TO_MERGE AND PR merged, move to `knowledge-base/plans/completed/`

## Failure scenarios (when I/O external)

```
(none — no external I/O touched)
```

The SDK owns the model call (mocked in tests); V4-O reads the already-fetched `RunResult.usage` and adds no external call of its own.

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phases 1-2. The plan is NOT done until this chain passes.

### Execution
```
npx vitest run packages/agents
npx vitest run --coverage packages/agents
npx tsc --noEmit -p packages/agents/tsconfig.test.json
npx eslint packages/agents/src --max-warnings=0
```

### Acceptance Criteria
- [ ] All test suites green — `npx vitest run packages/agents`
- [ ] Coverage ≥ 90% on changed files — `npx vitest run --coverage packages/agents`
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents/src --max-warnings=0`
- [ ] Runtime-metric proof — n/a this slice
- [ ] Failure scenarios green — n/a (`(none — no external I/O touched)`)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
