---
slug: v4n1-adapter-real-usage
milestone_id: V4-N
created_at: 2026-06-25
goal: Emit the SDK Run's real token usage on the adapter's done event so the loop reports non-zero split usage.
---

# Plan: V4-N.1 — `createSdkAgentStream` emits real SDK token usage on `done`

> **Version 1.1** (edge-case EC-1/EC-2 fold into T2.1; EC-3 documented) — V4-N added split-usage plumbing through the loop, but the SDK adapter emits `usage: {0,0,0}` hardcoded on the `done` event (both the translated `FINISHED` status and the fallback), so `DelegationResult.tokens`/`tokensInput`/`tokensOutput` are 0 on the real SDK path — a usage-analytics regression for any consumer (theocode). V4-N.1 makes `createSdkAgentStream` read the real `RunResult` via `run.wait()` after the stream and emit ONE `done` carrying the real `TokenUsage` (`inputTokens`/`outputTokens`/derived `totalTokens`) + `cost`, suppressing the stream's zero-usage `done`. Completes V4-N's usage story end-to-end. Additive to the event contract; reuses the SDK's documented `run.wait()` (Rule 9).

## Goal

> "Enable `createSdkAgentStream` to emit the SDK Run's real token usage so that the loop's `DelegationResult` carries non-zero `tokens`/`tokensInput`/`tokensOutput`, measured by `npx vitest run packages/agents/tests/integration/adapter-real-usage.test.ts` passing (the `done` event carries `run.wait().usage`)."

## Context

The V4-N review surfaced M1: `createSdkAgentStream` (`sdk-adapter.ts`) yields a `done` with `usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }` (the fallback at ~221, and the translated `FINISHED` status via `event-translator.ts`), and never calls `run.wait()`. So V4-N's split-usage fields populate from a zero `done` → always 0 on the real SDK path. theocode's current `defaultLlmStream` reads `run.wait().usage`; adopting `AgentRunner.stream()` without this would regress usage analytics to 0. The SDK exposes `Run.wait(): Promise<RunResult>` with `RunResult.usage?: TokenUsage { inputTokens, outputTokens }` + `cost` — the documented way to get per-run usage.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/bridge/sdk-adapter.ts` | ~240 | `7753e3d` (2026-06-25) | `createSdkAgentStream` streams the SDK Run + emits events; currently emits a zero-usage `done` | M8/V4-L/V4-M behavior unchanged; exactly ONE terminal (done/error) per round; SDK is the only runtime (G2) |
| `packages/agents/tests/integration/{runtime-overrides,systemprompt-resolver-stream,m8-adapter-wiring,sdk-adapter-translation,loop-session-history}.test.ts` | — | (V4-L/V4-M/V4-N) | mock `@theokit/sdk`; the mock `run` has `stream` but no `wait` | existing assertions preserved; mocks gain a `run.wait()` returning a usage |
| `packages/agents/tests/integration/adapter-real-usage.test.ts` (NEW) | 0 | — | (file to be created) | — |

`event-translator.ts` `translateStatusEvent` is NOT edited: the adapter SUPPRESSES the translated `done` (the zero-usage one) during streaming and emits its own real-usage `done` after `run.wait()`, so the translator stays generic.

### Current callers / dependents

- **Symbol:** `createSdkAgentStream` (`sdk-adapter.ts:65`) — callers: `agent-runner.ts` (stream), `agent-orchestrator.ts` (delegate), the 5 mock tests + the smoke test (real SDK, already has `run.wait`). The internal change is behind the same signature; the emitted `done` now carries real usage.
- **Symbol:** the loop's `done` consumer (`run-reflective-loop.ts` `applyDone`) reads `usage.inputTokens/outputTokens/totalTokens` (V4-N) — now populated with real values.
- **SDK:** `Run.wait(): Promise<RunResult>` (`run-D22b53SU.d.ts:892`); `RunResult.usage?: TokenUsage { inputTokens, outputTokens }` + `cost` (`:571,671,674`).

### Domain glossary

- **`run.wait()`** — the SDK Run's terminal await; returns `RunResult` with `usage` (real token counts) + `cost`, populated after the run completes. The documented way to read per-run usage (theocode's `defaultLlmStream` uses it).
- **suppress-and-re-emit** — the adapter drops the stream's zero-usage `done` and emits ONE `done` after `run.wait()` carrying the real usage (exactly-one-terminal preserved).

### Architecture boundaries affected

- None new — `createSdkAgentStream` already calls the SDK Run; V4-N.1 adds a `run.wait()` read on the same Run. SDK stays the only runtime (G2); no dependency change (G1).

## Prior Art & Related Work

- **Internal review** — `knowledge-base/reviews/v4n-loop-outcome-fidelity-review-2026-06-25.md` (M1 finding + the follow-up definition).
- **In-repo precedent** — theocode `server/lib/agent-stream.ts` `defaultLlmStream` reads `const result = await run.wait()` then `usageToTokens(result.usage)` — the exact pattern V4-N.1 brings into the adapter.
- **SDK contract** — `Run.wait()` + `RunResult.usage` (`run-D22b53SU.d.ts`): the documented per-run usage surface.

## Objective

- [ ] After the stream, `createSdkAgentStream` calls `run.wait()` and emits ONE `done` with real `usage` (`inputTokens`/`outputTokens`/`totalTokens`) + `cost`.
- [ ] The stream's zero-usage `done` is suppressed (exactly-one-terminal preserved).
- [ ] An `error` round still terminates with the error (no `wait()` re-emit after an error).
- [ ] The 5 SDK-mock tests gain a `run.wait()` + stay green; the loop's `DelegationResult` now reports real usage.
- [ ] Backward compatibility: same `createSdkAgentStream` signature; M8/V4-L/V4-M behavior unchanged.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | `>=2.9.0` (installed) | npm | `Run.wait()` + `RunResult.usage`/`cost` — the documented per-run usage surface. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | | | | No dependency added — uses the existing SDK `run.wait()`. |

### Removed

| Package | Last version | Why removed |
|---|---|---|

## ADRs

### D1 — Read `run.wait()` after the stream + emit ONE real-usage `done` (suppress the stream `done`)

- **Decision:** after iterating `run.stream()`, when no `error` was seen, `createSdkAgentStream` calls `await run.wait()` and emits a `done` with `usage` from `result.usage` (`totalTokens = inputTokens + outputTokens`) + `cost` from `result.cost`; the translated zero-usage `done` from the stream is filtered out (not yielded).
- **Rationale:** real usage is only available from `RunResult` (`run.wait()`), not the message stream (theocode does the same). Suppress-and-re-emit keeps exactly-one-terminal while upgrading its payload to real numbers.
- **Alternatives considered:** (a) Edit `translateStatusEvent` to carry usage — REJECTED: the stream's `FINISHED` message has no token totals; only `RunResult` does. (b) Emit a second `done` — REJECTED: breaks the loop's exactly-one-terminal (`deriveFinishReason`/B1). (c) Leave it 0 + map usage app-side — REJECTED: every consumer re-implements `run.wait()`; the adapter is the right place (DRY).
- **Consequences:** `done` is emitted after `run.wait()` (end of round) rather than mid-stream; payload now carries real usage + cost. `error` rounds skip the `wait()` re-emit.

### D2 — Mocks gain `run.wait()` (additive test wiring)

- **Decision:** the 5 SDK-mock tests' `run` object gains `wait: async () => ({ usage?, cost?, result? })`; the new test asserts the emitted `done` carries it.
- **Rationale:** the adapter now calls `run.wait()`; mocks must provide it (mirrors the V4-M create→getOrCreate mock sweep). Additive — existing assertions unaffected.
- **Alternatives considered:** (a) Make `wait()` optional in the adapter (guard `run.wait?.()`) — REJECTED: the real SDK always has `wait()`; a guard would hide a missing-usage bug. Updating mocks is the honest fix.
- **Consequences:** 5 mock files updated (mechanical); one new test asserts real usage flows.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `done` timing shifts from mid-stream to post-`wait()` | Low | The loop consumes `done` at round end regardless; tests assert the terminal + usage | maintainer |
| Mock sweep: 5 files need `run.wait()` | Low | Mechanical, typecheck/runtime-guarded; the suite catches a miss | maintainer |
| `run.wait()` throwing | Low | The whole block is inside the existing try/catch → surfaces as an `error` event (fail-loud) | maintainer |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (adapter: run.wait() + real-usage done + suppress + Run type) ──▶ Phase 2 (mock sweep + wiring proof)
                                                                              │
                                                                              ▼
                                                                     Final Phase: Integration Validation
```

## Phase 1: Adapter emits real usage

**Objective:** `createSdkAgentStream` suppresses the stream `done` and emits one real-usage `done` from `run.wait()`.

### T1.1 — `run.wait()` + real-usage done

#### Objective
After the stream loop, when no error was seen, call `run.wait()` and emit a `done` with real usage + cost; suppress the translated stream `done`; widen the `Run` type with `wait()`.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — filters `done` out of the translated stream; after the loop, calls `await run.wait()` and emits a `done` with `result.usage` (+ derived total) + `result.cost`; widens the `agent.send` return type to include `wait()`.
2. **Why it is necessary now** — it is the fix (ADR D1); without it V4-N's split usage stays 0 on the real path.

#### Evidence
`sdk-adapter.ts:202-226` (the `run.stream()` loop + the zero-usage fallback `done`); SDK `Run.wait()` (`run-D22b53SU.d.ts:892`) + `RunResult.usage`/`cost` (`:671,674`).

#### Files to edit
```
packages/agents/src/bridge/sdk-adapter.ts — Run type += wait(); suppress stream done; emit real-usage done after run.wait()
packages/agents/tests/integration/adapter-real-usage.test.ts — RED test added first (TDD)
```

#### Deep file dependency analysis
- `sdk-adapter.ts` — the `Agent.getOrCreate` return's `send` now returns `{ stream, wait }`; the stream loop drops `done`; after it (no error) emit the real-usage `done`. Downstream: the loop's `applyDone` (V4-N) reads the real usage.

#### Deep Dives
- **Invariant:** exactly one terminal per round (done OR error). Error path: yield the error, skip the `wait()` re-emit.
- **Edge case:** `result.usage` absent → 0s (defensive `?? 0`), like today.
- **Edge case:** `run.wait()` throws → caught by the surrounding try/catch → `error` event (fail-loud).
- **totalTokens:** derived `inputTokens + outputTokens` (SDK invariant EC-10).

#### Pseudo-code / Signatures
```ts
// Run type: { stream: () => AsyncGenerator<SdkMessage>; wait: () => Promise<RunResultLike> }
let sawError = false
for await (const sdkEvent of run.stream()) {
  for (const event of translateSdkEvent(sdkEvent, runId)) {
    if (event.type === 'done') continue           // suppress zero-usage stream done
    if (event.type === 'error') sawError = true
    yield event
  }
}
if (!sawError) {
  const result = await run.wait()
  const u = result.usage
  const inputTokens = u?.inputTokens ?? 0, outputTokens = u?.outputTokens ?? 0
  yield { type: 'done', result: result.result ?? '', usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }, durationMs: Date.now() - t0, cost: result.cost?.amount ?? 0 }
}
await agent.dispose()
```

#### Tasks
1. Widen the `Run` (agent.send return) type with `wait()`.
2. Suppress `done` in the stream loop; track `sawError`.
3. After the loop (no error), `run.wait()` + emit the real-usage `done`.
4. Run typecheck.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Types compile: `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Pass: complexity — `npx eslint packages/agents/src/bridge/sdk-adapter.ts --max-warnings=0`
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/adapter-real-usage.test.ts` ≥ 90% on changed files
- [ ] Pass: lint — `npx eslint packages/agents/src/bridge/sdk-adapter.ts --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/src/bridge/sdk-adapter.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents/src --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

## Phase 2: Mock sweep + wiring proof

**Objective:** the 5 SDK mocks provide `run.wait()`; a new test proves the `done` carries real usage.

### T2.1 — Mock sweep + real-usage wiring test

#### Objective
Each SDK-mock `run` gains `wait: async () => ({ usage: { inputTokens, outputTokens } })`; the new test asserts the emitted `done` (and the loop's `DelegationResult`) carries real usage.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — adds `wait()` to the 5 mock `run` objects; adds `adapter-real-usage.test.ts` asserting the adapter's `done` carries `run.wait().usage` and the loop's `DelegationResult.tokensInput`/`tokensOutput` are non-zero end-to-end.
2. **Why it is necessary now** — the adapter now calls `run.wait()`; without the mock wait, those tests throw. The new test is the Goal's proof.

#### Evidence
The 5 mock files' `send: async () => ({ stream })` (no `wait`); the adapter's new `run.wait()` call.

#### Files to edit
```
packages/agents/tests/integration/runtime-overrides.test.ts — run gains wait()
packages/agents/tests/integration/systemprompt-resolver-stream.test.ts — run gains wait()
packages/agents/tests/integration/m8-adapter-wiring.test.ts — run gains wait()
packages/agents/tests/integration/sdk-adapter-translation.test.ts — run gains wait()
packages/agents/tests/integration/loop-session-history.test.ts — run gains wait()
packages/agents/tests/integration/adapter-real-usage.test.ts (NEW) — real-usage done assertion
```

#### Deep file dependency analysis
- 5 mock updates (additive `wait`) + 1 new test driving `createSdkAgentStream` (or `AgentRunner.run`) with a mock `run.wait()` returning `{ usage: { inputTokens: 12, outputTokens: 7 } }` → assert the `done` event / `DelegationResult` carries 12/7/19.

#### Deep Dives
- **Assertion:** capture the adapter's emitted events; the `done` has `usage.inputTokens === 12`, `outputTokens === 7`, `totalTokens === 19`; via `AgentRunner.run`, `result.tokensInput === 12`, `tokensOutput === 7`.
- **Mock wait default:** mocks that do not assert usage return `wait: async () => ({})` (usage undefined → 0s).

#### Pseudo-code / Signatures
```ts
// mock run: { stream, wait: async () => ({ usage: { inputTokens: 12, outputTokens: 7 }, result: '' }) }
const result = await AgentRunner.builder(A).build().run('hi', { apiKey: 'k' })
expect(result.tokensInput).toBe(12); expect(result.tokensOutput).toBe(7); expect(result.tokens).toBe(19)
```

#### Tasks
1. Add `wait()` to the 5 mocks (default `async () => ({})`).
2. Create `adapter-real-usage.test.ts` asserting real usage flows to the `done` + `DelegationResult`.
3. Run the suite.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Real usage flows: `npx vitest run packages/agents/tests/integration/adapter-real-usage.test.ts`
- [ ] The 5 mocks stay green: `npx vitest run packages/agents`
- [ ] Pass: complexity — `npx eslint packages/agents/tests/integration/adapter-real-usage.test.ts --max-warnings=0`
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/integration/adapter-real-usage.test.ts` exercises the run.wait() done path
- [ ] Pass: lint — `npx eslint packages/agents/tests/integration/adapter-real-usage.test.ts --max-warnings=0`
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
| G1 | adapter emits zero usage on `done` | T1.1, T2.1 | `run.wait()` real usage on the emitted `done` (ADR D1) |
| G2 | stream's zero-usage `done` double-counts | T1.1 | suppress the stream `done`; emit one after `wait()` (ADR D1) |
| G3 | error rounds must not re-emit done | T1.1 | `sawError` skips the `wait()` re-emit |
| G4 | mocks lack `run.wait()` | T2.1 | the 5 mocks gain `wait()` (ADR D2) |
| G5 | no proof real usage reaches DelegationResult | T2.1 | end-to-end test asserts `tokensInput`/`tokensOutput` |
| G6 | backward compat (signature, M8/V4-L/V4-M) | T1.1, T2.1 | same signature; additive; full suite green |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `rules/architecture.md` / G6)
- [ ] CHANGELOG.md updated — add a changeset (patch or minor bump `@theokit/agents`)
- [ ] Backward compatibility preserved (same signature; the `done` now carries real usage)
- [ ] Plan-specific: `npx vitest run packages/agents/tests/integration/adapter-real-usage.test.ts` passes (the Goal metric)
- [ ] **Runtime-metric proof** — n/a (no new counter)
- [ ] **Plan archived** — after `/review` READY_TO_MERGE AND PR merged, move to `knowledge-base/plans/completed/`

## Failure scenarios (when I/O external)

```
(none — no external I/O touched)
```

`run.wait()` is the SDK's own per-run await (the SDK owns the model call, mocked in tests); V4-N.1 adds no external call of its own.

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phases 1-2. The plan is NOT done until this chain passes.

### Execution
```
npx vitest run packages/agents
npx vitest run --coverage packages/agents
npx tsc --noEmit -p packages/agents/tsconfig.test.json
npx eslint packages/agents/src/bridge/sdk-adapter.ts --max-warnings=0
```

### Acceptance Criteria
- [ ] All test suites green — `npx vitest run packages/agents`
- [ ] Coverage ≥ 90% on changed files — `npx vitest run --coverage packages/agents`
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings (changed files) — `npx eslint packages/agents/src/bridge/sdk-adapter.ts --max-warnings=0`
- [ ] Runtime-metric proof — n/a this slice
- [ ] Failure scenarios green — n/a (`(none — no external I/O touched)`)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
