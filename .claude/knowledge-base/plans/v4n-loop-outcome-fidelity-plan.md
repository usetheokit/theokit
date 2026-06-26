---
slug: v4n-loop-outcome-fidelity
milestone_id: V4-N
created_at: 2026-06-25
goal: Preserve tool-call id+input and split token usage through the reflective loop so consumers can port verify ladders + usage analytics.
---

# Plan: V4-N — preserve tool-call fidelity (id + input) and split usage in the reflective loop

> **Version 1.1** (edge-case EC-1/EC-2 fold into T2.1/T3.1; EC-3 documented) — The reflective loop flattens per-round data a consumer needs: `LoopOutcome.toolCalls` / `DelegationResult.toolCalls` entries are `{name, input, output}` but `consumeOneRound` builds them from `tool_result` events only, so `input` is always `{}` and there is no `id`; and `DelegationResult` collapses usage to one summed `tokens`. V4-N correlates each round's `tool_call` events (which carry the callId + input/command) with their `tool_result` events (which carry the output) to produce faithful `{id, name, input, output}` entries, and accumulates split `tokensInput`/`tokensOutput`. Additive + backward-compatible. Unblocks theocode's full adoption (its verify-before-finish / fix-failed-test ladder + tool persistence + usage analytics need the command, the id, and the token split).

## Goal

> "Enable the reflective loop to expose faithful per-round tool calls so that `LoopOutcome`/`DelegationResult` `toolCalls` carry `{id, name, input, output}` (input = the tool-call args, not `{}`) and `DelegationResult` carries split `tokensInput`/`tokensOutput`, measured by `npx vitest run packages/agents/tests/unit/loop-outcome-fidelity.test.ts` passing."

## Context

The theocode loop-adoption discover (`knowledge-base/discoveries/blueprints/v4n-loop-outcome-fidelity-blueprint.md`) proved that adopting `AgentRunner.stream()` for theocode's loop is blocked: a custom `ReflectionStrategy` only sees `LoopOutcome`, whose `toolCalls` entries lose the tool-call `input` (the command) and `id`, and whose usage is a single summed number. theocode's `ranVerification`/`lastVerificationOutcome` (`server/lib/agent-loop.ts`) need the command + id-paired structured result; its usage analytics need the input/output token split. It is the next framework-first slice (user-chosen) before the full adoption. The fix is localized to the loop's round consumption + two result types — additive, no behavior change for existing consumers.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/loop/run-reflective-loop.ts` | 363 | `8811577` (2026-06-25) | the loop driver; `consumeOneRound` accumulates a round's events into `RoundResult`; `runReflectiveLoopStream` builds `DelegationResult` | terminals/strategies/budget/signal/session (V4-M) unchanged; `responseText`/`cost`/`tokens` still populated; events still yielded live |
| `packages/agents/src/loop/loop-strategy.ts` | 86 | `58e6e30` | `LoopOutcome` value object consumed by `ReflectionStrategy`/`LoopStrategy` | existing fields unchanged; adding `id` to `toolCalls` entries is additive |
| `packages/agents/src/bridge/delegation-types.ts` | 51 | `58e6e30` | `DelegationResult` returned by the loop | existing fields unchanged; adding `id`/`tokensInput`/`tokensOutput` is additive |
| `packages/agents/tests/unit/loop-outcome-fidelity.test.ts` (NEW) | 0 | — | (file to be created) | — |

`packages/agents/src/bridge/event-translator.ts` (`translateToolCallEvent`) is NOT edited: it already passes the SDK `call_id` through on the real path (`callId = asString(msg.call_id, fallback)`) and `translateAssistantEvent` already emits `tool_call` events with `input`. V4-N's correlation consumes those existing fields; no translator change needed.

### Current callers / dependents

- **Symbol:** `LoopOutcome.toolCalls` (`loop-strategy.ts:35`) — consumed by `ReflectionStrategy.reflect(outcome, ctx)` (shipped ladder/noop + any custom strategy). Adding `id` is additive; existing strategies ignore it.
- **Symbol:** `DelegationResult` (`delegation-types.ts:14`) — returned by `runReflectiveLoop`/`AgentRunner.run`, and by `delegate()`. Adding `id`/`tokensInput`/`tokensOutput` is additive.
- **Symbol:** `consumeOneRound` / `RoundResult` (`run-reflective-loop.ts`) — internal to the loop; not exported.
- **Tests:** `main-loop-runtime.test.ts`, `reflection-context.test.ts`, `reflective-loop-stream.test.ts` exercise the loop; they must stay green (additive fields do not break them).

### Domain glossary

- **tool-call correlation** — pairing a round's `tool_call` event (carries `callId` + `input`/command) with its `tool_result` event (carries `callId` + `output`) by `callId`, to reconstruct a faithful `{id, name, input, output}` call record.
- **split usage** — `inputTokens`/`outputTokens` from `DoneEvent.usage` kept separately (not collapsed into `totalTokens`), so a consumer can map to its own usage model.

### Architecture boundaries affected

- None crossed — the change is internal to `packages/agents/src/loop` + the `delegation-types`/`loop-strategy` value objects. No SDK-surface change, no dependency change (G1/G2 intact).

## Prior Art & Related Work

- **Internal discover** — `knowledge-base/discoveries/blueprints/v4n-loop-outcome-fidelity-blueprint.md` (the gap + the localized fix) and `knowledge-base/discoveries/blueprints/theocode-loop-adoption-gap-blueprint.md` (the adoption context).
- **In-repo precedent** — `theocode/server/lib/sdk-mappers.ts:111-123` (`toolCallToEvent`) shows the target fidelity: it preserves `data: msg.result` + `id: msg.call_id`. V4-N brings the loop's `toolCalls` to parity (id + input).
- **In-repo precedent** — V4-K threaded richer per-run state (`ReflectionContext`) into `reflect()`; V4-N enriches the `LoopOutcome` the same `reflect()` consumes.

## Objective

- [ ] `LoopOutcome.toolCalls` / `DelegationResult.toolCalls` entries carry `{id, name, input, output}` with `input` = the tool-call args (not `{}`).
- [ ] `DelegationResult` carries split `tokensInput` + `tokensOutput` (accumulated across rounds).
- [ ] Existing `cost`/`tokens`/`response`/terminals/strategies/session behavior unchanged.
- [ ] Backward compatibility: additive fields only; the existing loop suite stays green.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | `>=2.9.0` (installed) | npm | Source of the streamed `tool_call`/`tool_result`/`done` events V4-N correlates. No new usage. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| (none) | | | | Pure internal change; no dependency added. |

### Removed

| Package | Last version | Why removed |
|---|---|---|

## ADRs

### D1 — Correlate `tool_call` and `tool_result` events by `callId` in `consumeOneRound`

- **Decision:** `consumeOneRound` tracks a `Map<callId, {name, input}>` from `tool_call` events and, on each `tool_result` event, emits a `{id: callId, name, input (from the map, else {}), output}` entry.
- **Rationale:** the tool-call `input` (the command) lives ONLY on the `tool_call` event; the `output` lives on the `tool_result`. Correlating by `callId` is the faithful reconstruction (mirrors theocode's `toolCallToEvent` fidelity). The real SDK emits matching `call_id` on both.
- **Alternatives considered:** (a) Read `input` off the `tool_result` event — REJECTED: `tool_result` has no `input` (the current `{}` bug). (b) Add a new `data` field instead of fixing `input` — REJECTED: `input` is the existing, documented field; populating it correctly is the minimal fix, and `output` already carries the result string.
- **Consequences:** `toolCalls` entries become faithful; when ids don't match (SDK omitted them — rare fallback), `input` degrades to `{}` (no worse than today).

### D2 — Add `id` to the toolCall record + split usage to `DelegationResult` (additive)

- **Decision:** `LoopOutcome.toolCalls` and `DelegationResult.toolCalls` entries gain `id: string`; `DelegationResult` gains `tokensInput`/`tokensOutput` (accumulated from `DoneEvent.usage.inputTokens`/`outputTokens` per round). Existing `tokens` (total) stays.
- **Rationale:** consumers need the id for pairing and the token split for usage models; keeping `tokens` preserves existing consumers (additive).
- **Alternatives considered:** (a) Replace `tokens` with the split — REJECTED: breaks existing consumers reading `tokens`. (b) Omit `id` — REJECTED: id-pairing is part of the verify-ladder need.
- **Consequences:** richer result; additive fields are backward-compatible.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `tool_call`↔`tool_result` correlation relies on matching `callId` from the SDK | Low | The real SDK emits matching `call_id`; the fallback (`{}` input) is no worse than today; covered by a test asserting input survives | maintainer |
| Adding fields to widely-returned `DelegationResult` risks surprising consumers | Low | Additive only; existing fields unchanged; documented in the changeset | maintainer |
| Per-round usage split depends on `DoneEvent.usage` shape | Low | Defensive reads (`?? 0`); falls back to 0 like the existing `totalTokens` read | maintainer |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (types: LoopOutcome/DelegationResult/RoundResult) ──▶ Phase 2 (consumeOneRound correlation + usage split + accumulation) ──▶ Phase 3 (wiring proof)
                                                                                                                                       │
                                                                                                                                       ▼
                                                                                                                              Final Phase: Integration Validation
```

## Phase 1: Widen the result types (additive)

**Objective:** `LoopOutcome.toolCalls`, `DelegationResult.toolCalls`, and `RoundResult.toolCalls` entries gain `id`; `DelegationResult` gains `tokensInput`/`tokensOutput`.

### T1.1 — Add `id` + split-usage fields to the types

#### Objective
The three toolCall record shapes carry `id`; `DelegationResult` carries `tokensInput`/`tokensOutput`.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — edits `LoopOutcome.toolCalls` (`loop-strategy.ts`), `DelegationResult` (`delegation-types.ts`), and the internal `RoundResult` (`run-reflective-loop.ts`) to add `id` to entries + `tokensInput`/`tokensOutput` to `DelegationResult`/`RoundResult`.
2. **Why it is necessary now** — Phase 2's correlation populates these; the types must admit them first (ADR D2).

#### Evidence
`loop-strategy.ts:35` (`toolCalls: readonly {name,input,output}[]`); `delegation-types.ts:16-18` (`toolCalls`/`tokens`); `run-reflective-loop.ts` `RoundResult` (`{responseText, toolCalls, cost, tokens, finishReason, errorMessage}`) + `acc` init.

#### Files to edit
```
packages/agents/src/loop/loop-strategy.ts — LoopOutcome.toolCalls entry += id
packages/agents/src/bridge/delegation-types.ts — DelegationResult.toolCalls += id; += tokensInput/tokensOutput
packages/agents/src/loop/run-reflective-loop.ts — RoundResult.toolCalls += id; += tokensInput/tokensOutput
packages/agents/tests/unit/loop-outcome-fidelity.test.ts — RED tests added first (TDD)
```

#### Deep file dependency analysis
- `loop-strategy.ts` — `LoopOutcome` is consumed by `reflect()`; additive `id`. `delegation-types.ts` — `DelegationResult` is the loop's return; additive. `run-reflective-loop.ts` — `RoundResult` internal; `acc` (a `DelegationResult`) initializer adds `tokensInput: 0, tokensOutput: 0`.

#### Deep Dives
- **Invariant:** existing fields (`name/input/output`, `cost/tokens/response/rounds/finishReason`) unchanged; only additions.
- **Edge case:** entries built before correlation (none — Phase 2 builds them) — n/a.

#### Pseudo-code / Signatures
```ts
// loop-strategy.ts
readonly toolCalls: readonly { id: string; name: string; input: unknown; output: string }[]
// delegation-types.ts
toolCalls: { id: string; name: string; input: unknown; output: string }[]
tokensInput: number
tokensOutput: number
```

#### Tasks
1. Add `id` to the three toolCall record shapes.
2. Add `tokensInput`/`tokensOutput` to `DelegationResult` + `RoundResult` + the `acc` initializer.
3. Run typecheck.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Types compile: `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Pass: complexity — `npx eslint packages/agents/src/loop/loop-strategy.ts packages/agents/src/bridge/delegation-types.ts packages/agents/src/loop/run-reflective-loop.ts --max-warnings=0`
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/unit/loop-outcome-fidelity.test.ts` ≥ 90% on changed files
- [ ] Pass: lint — `npx eslint packages/agents/src/loop/loop-strategy.ts packages/agents/src/bridge/delegation-types.ts packages/agents/src/loop/run-reflective-loop.ts --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/src/loop/run-reflective-loop.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents/src --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

## Phase 2: Correlate tool calls + split usage in `consumeOneRound`

**Objective:** `consumeOneRound` pairs `tool_call` (input) with `tool_result` (output) by `callId` → faithful `{id, name, input, output}`; captures split tokens.

### T2.1 — Correlation + usage split

#### Objective
`consumeOneRound` tracks `tool_call` events in a `Map<callId, {name, input}>` and, on each `tool_result`, emits `{id: callId, name, input, output}`; on `done`, captures `inputTokens`/`outputTokens`; `runReflectiveLoopStream` accumulates them into `acc`.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — adds the correlation map + the `tool_call` branch to `consumeOneRound`; populates `input` from the map on `tool_result`; reads split usage from `DoneEvent.usage`; accumulates `acc.tokensInput`/`acc.tokensOutput` in the loop.
2. **Why it is necessary now** — this is the actual fix (ADR D1); Phase 1's types admit it; Phase 3 proves it.

#### Evidence
`run-reflective-loop.ts` `consumeOneRound` (the `for await` over events: `text_delta`/`tool_result`/`done`/`error` branches — currently NO `tool_call` branch, and `tool_result` pushes `input: event.input ?? {}` = `{}`); the loop's `acc` accumulation (`acc.cost += r.cost; acc.tokens += r.tokens`).

#### Files to edit
```
packages/agents/src/loop/run-reflective-loop.ts — consumeOneRound correlation + split usage; acc accumulation
packages/agents/tests/unit/loop-outcome-fidelity.test.ts — RED tests (extends Phase 1 file)
```

#### Deep file dependency analysis
- `run-reflective-loop.ts` — add a `tool_call` handler (capture callId→{name,input}); change the `tool_result` handler to look up input by callId + set `id`; add `r.tokensInput`/`r.tokensOutput` from `DoneEvent.usage`; accumulate in `runReflectiveLoopStream`.

#### Deep Dives
- **Invariant:** event yielding live (unchanged — events still `yield`ed before accumulation); `finishReason` derivation (sawToolResult) unchanged; `responseText`/`cost`/`tokens` unchanged.
- **Edge case:** a `tool_result` with no matching `tool_call` (id mismatch) → `input: {}` (graceful, no worse than today).
- **Edge case:** `DoneEvent.usage` absent → `tokensInput/Output` default 0 (like the existing `totalTokens` read).

#### Pseudo-code / Signatures
```ts
const callInputs = new Map<string, { name: string; input: unknown }>()
for await (const event of factory(prompt, sessionId)) {
  yield event
  if (event.type === 'tool_call') callInputs.set(asString(event.callId,''), { name: asString(event.toolName,'unknown'), input: event.input ?? {} })
  else if (event.type === 'tool_result') {
    const id = asString(event.callId, '')
    const c = callInputs.get(id)
    r.toolCalls.push({ id, name: c?.name ?? asString(event.toolName,'unknown'), input: c?.input ?? {}, output: asString(event.output,'') })
  } else if (event.type === 'done') {
    const u = event.usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined
    r.tokensInput = u?.inputTokens ?? 0; r.tokensOutput = u?.outputTokens ?? 0; r.tokens = u?.totalTokens ?? 0
    r.cost = asNumber(event.cost, 0)
  }
}
// loop: acc.tokensInput += r.tokensInput; acc.tokensOutput += r.tokensOutput
```

#### Tasks
1. Add the `callInputs` map + `tool_call` branch.
2. Rewrite the `tool_result` push to use the correlated input + id.
3. Capture split usage on `done`; accumulate in the loop.
4. Run the tests.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] `input` survives + `id` present: `npx vitest run packages/agents/tests/unit/loop-outcome-fidelity.test.ts`
- [ ] split usage accumulated (same command)
- [ ] Existing loop tests green: `npx vitest run packages/agents/tests/unit/main-loop-runtime.test.ts packages/agents/tests/unit/reflection-context.test.ts`
- [ ] Pass: complexity — `npx eslint packages/agents/src/loop/run-reflective-loop.ts --max-warnings=0`
- [ ] Pass: coverage — `npx vitest run --coverage packages/agents/tests/unit/loop-outcome-fidelity.test.ts` exercises the correlation + usage path
- [ ] Pass: lint — `npx eslint packages/agents/src/loop/run-reflective-loop.ts --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/src/loop/run-reflective-loop.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents/src --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

## Phase 3: Wiring proof

**Objective:** an end-to-end loop run yields faithful toolCalls (id+input+output) + split usage in the DelegationResult, and a custom ReflectionStrategy sees the input.

### T3.1 — Integration: faithful toolCalls + split usage end-to-end

#### Objective
Drive a mocked round stream (tool_call with a command + tool_result + done-with-usage) through the loop; assert the `DelegationResult.toolCalls[0]` has `{id, name, input:{command}, output}` and `tokensInput`/`tokensOutput`; and a custom `ReflectionStrategy` receives `outcome.toolCalls[0].input.command`.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — a test driving `runReflectiveLoop` with a factory yielding a `tool_call` (input `{command:'pytest'}`) + `tool_result` (output) + `done` (usage split); asserts the result fidelity + that a custom strategy sees the command.
2. **Why it is necessary now** — the Goal's metric; proves the correlation fires end-to-end, not just compiles (this is what the theocode verify-ladder will rely on).

#### Evidence
`run-reflective-loop.ts` `runReflectiveLoop` (collect wrapper) + `reflect(outcome, ctx)` call site.

#### Files to edit
```
packages/agents/tests/unit/loop-outcome-fidelity.test.ts — end-to-end fidelity + strategy-sees-input
```

#### Deep file dependency analysis
- Test only — drives the real `runReflectiveLoop` with a synthetic factory (no SDK); a custom ReflectionStrategy captures `outcome.toolCalls`.

#### Deep Dives
- **Assertions:** `result.toolCalls[0].id === 'c1'`, `.input` deep-equals `{command:'pytest'}`, `.output === '...'`; `result.tokensInput === N`, `result.tokensOutput === M`; the custom strategy saw `outcome.toolCalls[0].input`.

#### Pseudo-code / Signatures
```ts
const factory = mockFactory([[
  { type:'tool_call', callId:'c1', toolName:'shell_exec', input:{command:'pytest'} },
  { type:'tool_result', callId:'c1', toolName:'shell_exec', output:'ok' },
  { type:'done', usage:{inputTokens:10,outputTokens:5,totalTokens:15} },
]])
const result = await runReflectiveLoop(factory, 'task', 's', { loop: resolveLoopStrategy('simple-chat',1), reflection: capture })
expect(result.toolCalls[0]).toMatchObject({ id:'c1', name:'shell_exec', input:{command:'pytest'}, output:'ok' })
expect(result.tokensInput).toBe(10); expect(result.tokensOutput).toBe(5)
```

#### Tasks
1. Add the end-to-end fidelity test + the strategy-sees-input assertion.
2. Run.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] Faithful toolCalls + split usage: `npx vitest run packages/agents/tests/unit/loop-outcome-fidelity.test.ts`
- [ ] A custom ReflectionStrategy sees `outcome.toolCalls[0].input` (same command)
- [ ] Pass: complexity — `npx eslint packages/agents/tests/unit/loop-outcome-fidelity.test.ts --max-warnings=0`
- [ ] Pass: coverage — same vitest --coverage exercises the result-building path
- [ ] Pass: lint — `npx eslint packages/agents/tests/unit/loop-outcome-fidelity.test.ts --max-warnings=0`
- [ ] Pass: size — `test "$(wc -l < packages/agents/tests/unit/loop-outcome-fidelity.test.ts)" -le 500`

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `architecture.md` / G6)

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| G1 | toolCall `input` lost (always `{}`) | T2.1, T3.1 | correlate tool_call→tool_result by callId; test asserts input survives (ADR D1) |
| G2 | toolCall `id` absent | T1.1, T2.1, T3.1 | `id` added to the record + populated from callId (ADR D1/D2) |
| G3 | usage collapsed to one `tokens` | T1.1, T2.1, T3.1 | split `tokensInput`/`tokensOutput` accumulated (ADR D2) |
| G4 | custom ReflectionStrategy can't see the command | T3.1 | end-to-end test: strategy receives `outcome.toolCalls[].input` |
| G5 | backward compat (existing fields/consumers) | T1.1, T2.1 | additive only; existing loop suite green |
| G6 | no proof of end-to-end fidelity | T3.1 | integration drives the real loop + asserts the DelegationResult |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `npx vitest run packages/agents` green
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings — `npx eslint packages/agents --max-warnings=0`
- [ ] File-size budget respected (per `rules/architecture.md` / G6)
- [ ] CHANGELOG.md updated — add a changeset (minor bump `@theokit/agents`)
- [ ] Backward compatibility preserved (additive fields; existing consumers unaffected)
- [ ] Plan-specific: `npx vitest run packages/agents/tests/unit/loop-outcome-fidelity.test.ts` passes (the Goal metric)
- [ ] **Runtime-metric proof** — n/a (no new counter)
- [ ] **Plan archived** — after `/review` READY_TO_MERGE AND PR merged, move to `knowledge-base/plans/completed/`

## Failure scenarios (when I/O external)

```
(none — no external I/O touched)
```

V4-N only restructures how already-streamed events are accumulated; the SDK owns the model call (mocked in tests).

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phases 1-3. The plan is NOT done until this chain passes.

### Execution
```
npx vitest run packages/agents
npx vitest run --coverage packages/agents
npx tsc --noEmit -p packages/agents/tsconfig.test.json
npx eslint packages/agents/src/loop/run-reflective-loop.ts packages/agents/src/loop/loop-strategy.ts packages/agents/src/bridge/delegation-types.ts --max-warnings=0
```

### Acceptance Criteria
- [ ] All test suites green — `npx vitest run packages/agents`
- [ ] Coverage ≥ 90% on changed files — `npx vitest run --coverage packages/agents`
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`
- [ ] Zero lint warnings (changed files) — the eslint command above
- [ ] Runtime-metric proof — n/a this slice
- [ ] Failure scenarios green — n/a (`(none — no external I/O touched)`)

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
