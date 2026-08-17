---
slug: v4p-loop-transient-retry
milestone_id: V4-P
created_at: 2026-06-26
goal: Retry a transient failure at a reflective-loop round start so a multi-round run recovers instead of aborting.
---

# Plan: V4-P — per-round transient retry in the reflective loop

> **Version 1.0** — the reflective loop (`runReflectiveLoopStream`) consumes one SDK stream turn per round with NO transient retry: a 429/5xx at a round start aborts the whole run. A consumer adopting `AgentRunner.stream()` (theocode's loop collapse) loses its per-round `withRetry`-at-stream-start safety — a test-guarded regression (`test_runCodeAgent_retries_transient_error_on_continuation_round`). The SDK does not auto-retry the `send`/`stream` LLM path (its `internal/llm/retry.ts` is an empty stub; the only `withRetry` is workflow-step-scoped). V4-P adds an optional `retry?: RetryOptions` to the loop: it retries ONLY the round start (factory creation + first event, before any event is yielded → no re-applied edit), reusing the SDK's documented `withRetry` (`@theokit/sdk/retry`, Rule 9). Default: no retry (backward-compatible).

## Goal

> "Enable `runReflectiveLoopStream` (and `AgentRunner.stream()`) to retry a transient failure at a round start so a multi-round run recovers, measured by `npx vitest run packages/agents/tests/unit/loop-transient-retry.test.ts` passing (a round whose start throws a retryable error once then succeeds completes the run)."

## Context

The theocode loop-adoption discover (blueprint recorded in the theocode repo) found that theocode wraps each round's stream start in `withRetry` (T5/V2-2A): a transient blip before any event is recovered without re-applying an edit. `AgentRunner.stream()` owns the loop and does NOT retry, so adopting it drops that safety. The SDK's `@theokit/sdk/retry` `withRetry` (default `isRetryable: isTransientError`) is the exact primitive theocode uses; V4-P brings the same wrap into the framework loop, gated by an opt-in `retry` config so existing behavior is unchanged when absent.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/loop/run-reflective-loop.ts` | ~468 | `57a66f5` (2026-06-26) | the reflective driver: `consumeOneRound` consumes one SDK turn; the loop reflects + decides continuation | exactly-one-terminal; no retry after an event yielded; abort honored; SDK stays optional (no static SDK value import) |
| `packages/agents/src/loop/agent-runner.ts` | ~257 | (V4-M/L) | `AgentRunner.stream`/`run` + `AgentRunnerRunOptions` | same signatures; additive option |
| `packages/agents/tests/unit/loop-transient-retry.test.ts` (NEW) | 0 | — | (file to be created) | — |

### Current callers / dependents

- **Symbol:** `consumeOneRound` (`run-reflective-loop.ts:324`) — called by `consumeRoundOrThrow` (`:151`); iterates `factory(prompt, sessionId)`. The change wraps the START (creation + first event) in `withRetry` when `retry` is configured.
- **Symbol:** `AgentRunner.stream` (`agent-runner.ts:157`) — builds the loop config; the change threads `opts.retry` into `RunReflectiveLoopConfig`.
- **SDK:** `withRetry(fn, RetryOptions)` (`@theokit/sdk/retry`); `RetryOptions { retries?, isRetryable?=isTransientError, initialDelayMs?, maxDelayMs?, backoffMultiplier?, rng?, sleep?, signal? }`.

### Domain glossary

- **round start** — the factory creation + the first `await iterator.next()`; before any event is yielded, so retrying re-runs nothing user-visible (no re-applied edit).
- **retry-at-start** — wrap ONLY the start in `withRetry`; once the first event is obtained, iterate normally (a mid-stream throw is NOT retried — it may have applied edits).

### Architecture boundaries affected

- None new. `@theokit/agents` already depends on `@theokit/sdk` (the adapter dynamic-imports it). V4-P keeps the SDK OPTIONAL: the value `withRetry` is loaded via dynamic `import('@theokit/sdk/retry')` only when `retry` is configured; the `RetryOptions` type is an erased `import type`. No static SDK value import is added (G1/G2 preserved).

## Prior Art & Related Work

- **In-repo consumer** — theocode `server/lib/agent-stream.ts` wraps each round start: `withRetry(async () => { const gen = stream(input); const first = await gen.next(); return { gen, first } }, { retries, isRetryable: isTransientError, initialDelayMs, maxDelayMs: 30_000, backoffMultiplier: 2 })` — the exact pattern V4-P brings into the loop.
- **SDK contract** — `@theokit/sdk/retry` `withRetry` + `RetryOptions` (default `isRetryable: isTransientError`): the documented retry primitive (Rule 9 — not reimplemented).
- **Internal precedent** — V4-L.2/V4-L.3 added per-run `AgentRunnerRunOptions` fields (Axis-A SWAP); V4-P adds `retry` the same way.

## Objective

- [ ] `RunReflectiveLoopConfig` + `AgentRunnerRunOptions` gain an optional `retry?: RetryOptions`.
- [ ] When `retry` is set, `consumeOneRound` retries the round START (creation + first event) via the SDK `withRetry`; once an event is yielded, a throw is NOT retried.
- [ ] When `retry` is absent, behavior is byte-identical to today (single attempt — backward-compatible).
- [ ] The SDK stays optional: `withRetry` is dynamic-imported only when `retry` is set; the `RetryOptions` type is `import type` (erased).
- [ ] A new test proves a retryable throw at a round start is retried then succeeds, and a non-retryable throw propagates.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | `>=2.9.0` (installed) | npm | `@theokit/sdk/retry` `withRetry` + `RetryOptions` — the documented retry primitive (Rule 9). |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | | | | No dependency added — reuses the SDK `withRetry`. |

### Removed

| Package | Last version | Why removed |
|---|---|---|

## ADRs

### D1 — Retry ONLY the round start, reusing the SDK `withRetry`

- **Decision:** `consumeOneRound` builds a `startRound()` thunk (factory creation + first `iterator.next()`); when `config.retry` is set, it runs `startRound` through `withRetry(startRound, retry)` (dynamic-imported from `@theokit/sdk/retry`); after the first event, it iterates the obtained iterator normally.
- **Rationale:** a transient before any event is yielded re-runs nothing user-visible (idempotent); retrying once an edit may have been applied is unsafe. The SDK `withRetry` (default `isRetryable: isTransientError`) is the exact primitive theocode uses (Rule 9 — not reimplemented). Mirrors theocode's verified pattern.
- **Alternatives considered:** (a) Reimplement backoff inline in the loop — REJECTED: reinvents `@theokit/sdk/retry` (Rule 9). (b) Static-import `withRetry` — REJECTED: breaks the SDK-optional design (the adapter dynamic-imports for this reason); V4-P uses dynamic import for the value + `import type` for the type. (c) Wrap the WHOLE `runner.stream()` consumption — REJECTED: retries from round 1, re-applying edits from earlier rounds.
- **Consequences:** when `retry` is set, a round-start transient is recovered; a mid-stream throw still propagates (exactly-one-terminal + no-double-edit preserved). When absent, no `withRetry` call (backward-compatible).

### D2 — `retry` is opt-in per run (Axis-A SWAP)

- **Decision:** `AgentRunnerRunOptions.retry?: RetryOptions` threads into `RunReflectiveLoopConfig.retry`; absent ⇒ single attempt.
- **Rationale:** retry policy is a per-request concern (a consumer chooses retries by mode); additive optional field never breaks existing callers (V4-L precedent).
- **Alternatives considered:** (a) Always retry with defaults — REJECTED: changes existing behavior (default `retries: 3`) for every current consumer silently. Opt-in keeps backward-compat.
- **Consequences:** consumers pass `retry: { retries: 2, initialDelayMs: ... }`; the decorator path (no run-options) is unaffected.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Dynamic import of `@theokit/sdk/retry` per retried round | Low | Module-cached after first import; only loaded when `retry` is set | maintainer |
| A non-idempotent first event slips past the start boundary | Low | Retry wraps creation + first `.next()` only; once yielded, no retry (matches theocode's verified contract) | maintainer |
| Abort during a backoff sleep | Low | `RetryOptions.signal` is set to the loop signal so the abortable sleep rejects and stops | maintainer |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (loop retry-at-start + AgentRunnerRunOptions.retry + thread) ──▶ Phase 2 (TDD proof: retry-then-succeed + non-retryable propagates + no-retry default)
                                                                            │
                                                                            ▼
                                                                   Final Phase: Integration Validation
```

## Phase 1: Retry the round start

**Objective:** `consumeOneRound` retries the round start when `retry` is set; `AgentRunner` threads `opts.retry`.

### T1.1 — Loop retry-at-start + run-option wiring

#### Objective
Refactor `consumeOneRound` to a manual iterator with a `startRound` thunk retried via the SDK `withRetry` when `config.retry` is set; add `retry?: RetryOptions` to `RunReflectiveLoopConfig` + `AgentRunnerRunOptions` and thread it through `AgentRunner.stream`.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — replaces `for await (const event of factory(...))` with a manual async iterator whose START (creation + first `next()`) is wrapped in `withRetry` (dynamic-imported) when `retry` is configured; threads `retry` from `AgentRunnerRunOptions` → `RunReflectiveLoopConfig` → `consumeRoundOrThrow` → `consumeOneRound`.
2. **Why it is necessary now** — it is the fix (ADR D1); without it adopting `AgentRunner.stream()` drops the per-round retry the theocode test guards.

#### Evidence
`run-reflective-loop.ts:324` `consumeOneRound` (`:353` the `for await`); `:151` `consumeRoundOrThrow`; `:31` `RunReflectiveLoopConfig`; `agent-runner.ts:45` `AgentRunnerRunOptions` + `:157` `stream`; `@theokit/sdk/retry` `withRetry`/`RetryOptions`.

#### Files to edit
```
packages/agents/src/loop/run-reflective-loop.ts — RunReflectiveLoopConfig.retry; consumeOneRound retry-at-start (startRound thunk + dynamic withRetry); consumeRoundOrThrow passes retry
packages/agents/src/loop/agent-runner.ts — AgentRunnerRunOptions.retry; thread into RunReflectiveLoopConfig
```

#### Deep file dependency analysis
- `run-reflective-loop.ts` — `consumeOneRound` gains a `retry?` param; extracts a `startRound` thunk (creation + first event) so the manual loop stays within complexity budget (G6). `import type { RetryOptions } from '@theokit/sdk/retry'` (erased); `withRetry` dynamic-imported inside the retry branch.
- `agent-runner.ts` — `AgentRunnerRunOptions.retry?: RetryOptions`; `stream()` passes `retry: opts.retry` into the loop config.

#### Deep Dives
- **Invariant:** retry wraps ONLY creation + first `.next()`. Once an event is yielded, a throw propagates (no re-applied edit).
- **Invariant:** abort honored — `withRetry` receives `signal` so a backoff sleep aborts; the existing per-event abort check stays.
- **Edge case:** `retry` absent → `startRound()` is awaited directly (no `withRetry`), behavior identical to today.
- **Edge case:** non-retryable error → `withRetry` rethrows on the first attempt (default `isRetryable: isTransientError`); `consumeRoundOrThrow` normalizes it to `DelegationError`.
- **SDK-optional:** the value `withRetry` is dynamic-imported; absent SDK + `retry` set is a contradiction (the factory needs the SDK anyway).

#### Pseudo-code / Signatures
```ts
import type { RetryOptions } from '@theokit/sdk/retry'
// RunReflectiveLoopConfig.retry?: RetryOptions ; AgentRunnerRunOptions.retry?: RetryOptions
async function* consumeOneRound(factory, prompt, sessionId, signal, retry?: RetryOptions) {
  const startRound = async () => {
    const it = factory(prompt, sessionId)[Symbol.asyncIterator]()
    return { it, first: await it.next() }
  }
  const { it, first } = retry
    ? await (await import('@theokit/sdk/retry')).withRetry(startRound, { ...retry, signal: retry.signal ?? signal })
    : await startRound()
  let next = first
  while (!next.done) {
    if (signal?.aborted) break
    yield next.value
    accumulateEvent(next.value, r, signals, callInputs)
    next = await it.next()
  }
  r.finishReason = deriveFinishReason(signals)
  return r
}
```

#### Tasks
1. Add `retry?: RetryOptions` to `RunReflectiveLoopConfig` + `AgentRunnerRunOptions`; thread through `stream` + `consumeRoundOrThrow`.
2. Refactor `consumeOneRound` to manual iterator + `startRound` thunk + retry-at-start.
3. Run typecheck + lint (G6 complexity).

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Types compile: `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Pass: complexity — `npx eslint packages/agents/src/loop/run-reflective-loop.ts --max-warnings=0`
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/unit/loop-transient-retry.test.ts` ≥ 90% on changed files
- [ ] Pass: lint — `npx eslint packages/agents/src --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/src/loop/run-reflective-loop.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents/src --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

## Phase 2: TDD proof

**Objective:** tests prove retry-then-succeed, non-retryable propagation, and the no-retry default.

### T2.1 — Retry behavior tests

#### Objective
A new `loop-transient-retry.test.ts` asserts: (a) a round whose start throws a retryable error once then succeeds completes the run; (b) a non-retryable error propagates as `DelegationError`; (c) with no `retry` config, a thrown start is NOT retried (single attempt).

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — drives `runReflectiveLoop` with a fake factory whose first invocation throws (retryable) and second succeeds; asserts the run completes; asserts attempt counts; uses an injected `sleep: async () => {}` (no real timer) in `RetryOptions`.
2. **Why it is necessary now** — retry-at-start is the Goal's metric; without the test the behavior is unproven and the theocode regression is not closed.

#### Evidence
theocode `test_runCodeAgent_retries_transient_error_on_continuation_round` (the regression this closes); `RetryOptions.sleep`/`rng` injection (deterministic tests).

#### Files to edit
```
packages/agents/tests/unit/loop-transient-retry.test.ts (NEW) — retry-then-succeed + non-retryable + no-retry-default
```

#### Deep file dependency analysis
- New test: a factory counter; attempt 1 throws `{ retryable: true }` (custom `isRetryable: () => true` in the test's `retry` opts to avoid coupling to SDK error classes), attempt 2 yields a `done`. Assert the result is the success. A second case: `isRetryable: () => false` → the error propagates. A third: no `retry` → the first throw propagates (counter === 1).

#### Deep Dives
- **Determinism:** pass `retry: { retries: 2, isRetryable: () => true, sleep: async () => {}, initialDelayMs: 0 }` so no real timer runs.
- **Assertion:** retry case → `result.response`/terminal reflects the successful round; factory invoked twice. Non-retryable → `await expect(runReflectiveLoop(...)).rejects.toThrow`. No-retry → factory invoked once, rejects.

#### Pseudo-code / Signatures
```ts
let calls = 0
const factory = (msg, sid) => ({ async *[Symbol.asyncIterator]() {
  calls++
  if (calls === 1) throw new Error('boom')        // transient at start
  yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
} })
const result = await runReflectiveLoop(factory, 'task', 's', {
  loop: resolveLoopStrategy('simple-chat', 1), reflection: noopReflectionStrategy,
  retry: { retries: 2, isRetryable: () => true, sleep: async () => {}, initialDelayMs: 0 },
})
expect(calls).toBe(2)
```

#### Tasks
1. Create `loop-transient-retry.test.ts` with the three cases.
2. Run the suite.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Retry-then-succeed: `npx vitest run packages/agents/tests/unit/loop-transient-retry.test.ts`
- [ ] Full suite green: `npx vitest run packages/agents`
- [ ] Pass: complexity — `npx eslint packages/agents/tests/unit/loop-transient-retry.test.ts --max-warnings=0`
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/unit/loop-transient-retry.test.ts` exercises the retry branch
- [ ] Pass: lint — `npx eslint packages/agents/tests --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/tests/unit/loop-transient-retry.test.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| G1 | loop does not retry a round-start transient | T1.1, T2.1 | retry-at-start via SDK `withRetry` (ADR D1) |
| G2 | retry must not re-apply edits | T1.1, T2.1 | wrap ONLY creation + first event; mid-stream throw propagates |
| G3 | retry must be opt-in (backward-compat) | T1.1, T2.1 | `retry?` optional; absent ⇒ single attempt (ADR D2) |
| G4 | SDK must stay optional | T1.1 | dynamic `import('@theokit/sdk/retry')`; `import type` for the type |
| G5 | non-retryable errors must propagate | T1.1, T2.1 | `withRetry` rethrows; `consumeRoundOrThrow` normalizes to `DelegationError` |
| G6 | abort during backoff | T1.1 | `RetryOptions.signal` set to the loop signal |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `rules/architecture.md` / G6)
- [ ] CHANGELOG.md updated — add a changeset (minor bump `@theokit/agents`)
- [ ] Backward compatibility preserved (retry opt-in; absent ⇒ single attempt)
- [ ] Plan-specific: `npx vitest run packages/agents/tests/unit/loop-transient-retry.test.ts` passes (the Goal metric)
- [ ] **Runtime-metric proof** — n/a (no new counter)
- [ ] **Plan archived** — after `/review` READY_TO_MERGE AND PR merged, move to `knowledge-base/plans/completed/`

## Failure scenarios (when I/O external)

```
- Transient LLM failure (429 / 5xx / network) at a round start:
  reproduced by a fake factory whose first invocation throws a retryable error;
  expected: withRetry recovers (second attempt succeeds) and the run completes.
- Sustained transient outage (always throws retryable):
  reproduced by a factory that always throws; expected: retries exhaust, the error
  propagates as DelegationError (no silent stop).
```

The factory abstracts the SDK Run; tests inject the throw + an instant `sleep` (no real timer, no real network). The real model call stays in the SDK.

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
- [ ] Failure scenarios green — the retry-exhaustion + retry-then-succeed tests pass

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
