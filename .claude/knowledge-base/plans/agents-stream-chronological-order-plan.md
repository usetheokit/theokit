# Plan: Chronological event ordering in @theokit/agents AgentRunner.stream()

> **Version 1.1** (edge-case-plan absorbed 2026-06-28: EC-1 callId-based tool dedup, EC-2/EC-3 tests) — Fix theokit issue #44: `createSdkAgentStream` currently emits every `text_delta` before every `tool_call`/`tool_result` because the `onDelta` merge (shipped in `@theokit/agents@0.21.1` for #40) only routes `text-delta` through the real-time callback and pulls tool events from the post-completion `run.stream()` buffer. This plan routes tool (and thinking) updates through `onDelta` in arrival order and consumes the merge queue concurrently with `send()`, so the stream emits events in true chronological order (text/tool/thinking interleaved) and in real time. Backward-compatible: no public API change; `run.stream()` stays the fallback for providers that never drive `onDelta`.

## Goal

> Enable `@theokit/agents` stream consumers to receive `StreamEvent`s in true chronological arrival order (text/tool interleaved), measured by the integration test `test_stream_emits_events_in_chronological_arrival_order` asserting the emitted sequence matches the `onDelta` arrival sequence (no all-text-then-all-tools reordering).

## Context

Issue #44 (usetheodev/theokit) reports that a multi-round agent turn renders as one narration block followed by a cluster of tool cards, instead of `[text] [tool] [text] [tool] [final text]`. This was caught by live dogfooding (theocode in Chrome): the assistant narration ("Criei sea.txt… A busca retornou… Confirmado…") rendered entirely before the `write_file`/`glob_files` cards, even though the narration references results the tools produced later.

It is a **regression introduced by #40** (`fix(agents): stream incremental tokens + tool output + running tool_call`, commit `2c6e03f`, 2026-06-28, shipped as `@theokit/agents@0.21.1`). Before #40 the adapter consumed only `run.stream()` (complete messages in chronological order — correct order, chunky text). #40 added the `onDelta` merge to stream tokens incrementally but routed only `text-delta` through `onDelta`, leaving tool events on the post-completion `run.stream()` path; the merge queue therefore receives all deltas first, all tool messages second.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/bridge/sdk-adapter.ts` | 405 | `2c6e03f` (2026-06-28) | Bridges compiled decorators → `@theokit/sdk` runtime; `createSdkAgentStream` yields `StreamEvent`s via `Agent.getOrCreate` + `send`(onDelta) + `Run.stream()` | Must stay < 500 LoC (G6); `SDK_NOT_INSTALLED` path, `finally` dispose, `realUsageDone` after `run.wait()`, `RuntimeOverrides`/`conversationStorage` (V4-L/V4-M) all preserved; public factory signature unchanged |
| `packages/agents/src/bridge/event-translator.ts` | 161 | `2c6e03f` (2026-06-28) | Adapter `translateSdkEvent` (SDK `SDKMessage` → `StreamEvent[]`) + `serializeToolOutput` | `translateSdkEvent` stays the fallback for the no-onDelta path; `serializeToolOutput` reused for tool-result serialization; must stay < 500 LoC |
| `packages/agents/tests/integration/sdk-adapter-streaming.test.ts` | 159 | `2c6e03f` (2026-06-28) | Fake-Agent streaming tests for #40 (incremental deltas + dedup + no-delta fallback) | Existing tests must keep passing (or be updated for the new dedup contract — no behavior loss) |
| `packages/agents/tests/unit/event-translator.test.ts` | 184 | `2c6e03f` (2026-06-28) | Unit tests for `translateSdkEvent` + `serializeToolOutput` | Existing assertions stay green |

Every file in any `#### Files to edit` block appears here.

### Current callers / dependents

- **Symbol:** `createSdkAgentStream` in `packages/agents/src/bridge/sdk-adapter.ts`
  - **Callers (production):** `packages/agents/src/loop/agent-runner.ts`, `packages/agents/src/bridge/agent-compiler.ts`, `packages/agents/src/bridge/agent-orchestrator.ts`, `packages/agents/src/loop/run-reflective-loop.ts`, re-exported via `packages/agents/src/bridge/index.ts`
  - **Callers (tests):** 16 test files incl. `sdk-adapter-streaming.test.ts`, `sdk-adapter-translation.test.ts`, `runner-stream-factory.test.ts`, `reflective-loop-stream.test.ts`, `adapter-real-usage.test.ts`, `smoke/sdk-real-llm.test.ts`
  - **External (public API consumed by other repos):** yes — `theocode` consumes the emitted `StreamEvent` stream via `AgentRunner.stream()`; contract is the `StreamEvent` union (`text_delta`/`tool_call`/`tool_result`/`thinking`/`run_started`/`done`/`error`). This plan does NOT change the union — only the ORDER and SOURCE of the content events.
- **Symbol:** `translateSdkEvent` in `packages/agents/src/bridge/event-translator.ts`
  - **Callers (production):** `packages/agents/src/bridge/sdk-adapter.ts` (`mergeDeltaStream`)
  - **Callers (tests):** `packages/agents/tests/unit/event-translator.test.ts`, `packages/agents/tests/integration/sdk-adapter-translation.test.ts`
- **Symbol:** `mergeDeltaStream`, `createAsyncQueue`, `MergeItem` (module-internal to `sdk-adapter.ts`) — no external callers.

### Domain glossary

- **`onDelta`** — SDK `SendOptions` callback invoked in real time during `agent.send()` with `{ update: InteractionUpdate }` as the model streams.
- **`InteractionUpdate`** — discriminated union of real-time updates (`@theokit/sdk` `types/updates.ts:166`): `text-delta`, `thinking-delta`, `thinking-completed`, `tool-call-started`, `tool-call-completed`, `partial-tool-call`, `token-delta`, `step-*`, etc.
- **`run.stream()`** — async generator on the resolved `Run` that replays the run's **complete** `SDKMessage`s (system/assistant/tool_call/thinking/status) **after** `send()` resolves.
- **`StreamEvent`** — the agents-bridge wire event (`text_delta`/`tool_call`/`tool_result`/`thinking`/`run_started`/`done`/`error`).
- **Merge queue** — `createAsyncQueue<MergeItem>`; a single-consumer queue carrying `{kind:'delta'}` (onDelta-sourced) and `{kind:'sdk'}` (run.stream-sourced) items; preserves insertion order.
- **`sawDelta` dedup** — flag (#40) that suppresses the complete-assistant `text_delta` from `run.stream()` when `onDelta` already streamed it.

### Architecture boundaries affected

- **G2 / `sdk-runtime.md` (SDK is the only runtime):** respected — this plan does NOT reimplement any LLM/loop/streaming logic. It only re-routes WHICH SDK callback (`onDelta` vs `run.stream()`) surfaces each event. Both are SDK-provided.
- **G1 (dependency direction):** unchanged — `agents` continues to import `@theokit/sdk` types only (type-only `InteractionUpdate`).
- **G6 (file size ≤ 500 LoC):** the new update→StreamEvent translator lives in `event-translator.ts` (not `sdk-adapter.ts`) to keep the adapter under budget.
- **G8 (Web standards):** unaffected.

## Prior Art & Related Work

- **In-repo adapter (the code under change):** `packages/agents/src/bridge/sdk-adapter.ts` — `createSdkAgentStream` (lines 247-405), `createAsyncQueue` (171-203), `mergeDeltaStream` (213-239), `onDelta` (370-378). These are the #40 implementation that introduced the regression.
- **In-repo translator template:** `packages/agents/src/bridge/event-translator.ts` — `translateSdkEvent` (145-161) is the structural template the new `translateInteractionUpdate` mirrors; `serializeToolOutput` (26-37) is reused verbatim for tool-result serialization.
- **SDK real-time update contract:** `@theokit/sdk` `packages/sdk/src/types/updates.ts` — `InteractionUpdate` union (line 166); `TextDeltaUpdate` (21), `ThinkingDeltaUpdate` (31), `ToolCallStartedUpdate` (51), `ToolCallCompletedUpdate` (75), `ToolCall { callId, name, args?, result? }` (9). This is the evidence that `onDelta` already carries tool + thinking updates in real time — the foundation of the fix.
- **SDK send() semantics:** `@theokit/sdk` `packages/sdk/src/internal/runtime/local-agent/local-agent.ts:222-291` — `send()` resolves only after the full run lifecycle (mutex comment 235-239: "spans the FULL run lifecycle — dispatch + run.wait() + post-run"); this is why `run.stream()` is a post-completion buffer and cannot carry real-time ordering.
- **Issue:** usetheodev/theokit#44 (filed with repro + root-cause + this fix direction).

## Objective

- [ ] Tool events (`tool_call`, `tool_result`) are emitted from `onDelta` in real-time arrival order, interleaved with `text_delta`.
- [ ] Thinking events (`thinking`) are also routed through `onDelta` (same coherent content-update path), preventing a parallel ordering bug.
- [ ] The merge queue is consumed CONCURRENTLY with `send()` (events surface as they arrive, not flushed after the run completes).
- [ ] Per-category dedup prevents double-emit: `run.stream()` content events (`text_delta`/`tool_call`/`tool_result`/`thinking`) are suppressed only for the categories `onDelta` actually drove (robust against providers that drive `onDelta` partially).
- [ ] The no-`onDelta` provider path still works via `run.stream()` (chronologically correct complete messages) — fallback unbroken.
- [ ] `send()` rejection still surfaces an `error` event and disposes the agent (no hang, no leak).
- [ ] No public API change; `sdk-adapter.ts` stays < 500 LoC.

## ADRs

### D1 — Route tool + thinking updates through `onDelta`, not `run.stream()`
- **Decision:** In the `onDelta` callback, translate `tool-call-started` → `tool_call`, `tool-call-completed` → `tool_result`, `thinking-delta` → `thinking` (in addition to the existing `text-delta` → `text_delta`), pushing each as a `{kind:'delta'}` item so the merge queue records them in real-time arrival order. `partial-tool-call` is intentionally ignored (incremental args; emitting it would create duplicate tool cards).
- **Rationale:** `InteractionUpdate` already delivers these updates chronologically interleaved with text (`updates.ts:166`). Routing them through the same queue as text deltas makes the queue's insertion order equal the model's true event order — the direct fix for #44. Mirrors `sdk-runtime.md` (we re-route SDK callbacks; we do not reimplement).
- **Alternatives considered:** (a) Reorder the `run.stream()` buffer by timestamp post-hoc — REJECTED: `SDKMessage`s carry no per-event arrival timestamp, and `run.stream()` is post-completion so it can never be real-time. (b) Fix ordering in the theocode UI — REJECTED: #44 is a framework defect (the SSE event order itself is wrong); a streaming UI renders in arrival order and cannot reconstruct chronology the framework destroyed.
- **Consequences:** Enables correct, real-time interleaving. Constrains: requires per-category dedup (D3) so the same events from `run.stream()` are not double-emitted.

### D2 — Consume the merge queue concurrently with `send()`
- **Decision:** Start `agent.send(message, { onDelta })` WITHOUT awaiting it; begin consuming the merge queue immediately. The `run.stream()` pump awaits the send promise internally (to obtain the resolved `Run`) and feeds structural events (`run_started`/`done`/`error`) + the no-onDelta fallback into the same queue, then closes it. Await the send promise once more at the end for `run.wait()` real-usage.
- **Rationale:** D1 alone fixes ORDER (events are queued in arrival order), but because the consumer historically started only after `await send()`, the queue was buffered-then-flushed (not real time). Consuming concurrently makes `onDelta`-sourced events surface as the model generates them — closing the original "thinking… then everything at once" DX complaint while keeping order correct.
- **Alternatives considered:** Keep `await agent.send()` before consuming (D1 only) — REJECTED: fixes order but text/tools still flush at the end of the run, not real-time; the user's DX complaint was both order AND batching. The concurrent consume is the same cost (the pump already runs concurrently in #40) and removes the artificial barrier.
- **Consequences:** Structural events (`run_started`/`done`) arrive after the content stream (they come from the post-completion `run.stream()`); this matches the already-shipped #40 behavior and is irrelevant to consumers (theocode drops `run_started`/`done`; terminal usage comes from `realUsageDone`/`DelegationResult`). Documented in Drawbacks.

### D3 — Hybrid dedup: text/thinking by category flag, tool by callId (EC-1)
- **Decision:** Dedup the two event sources by the finest granularity each category supports. `text_delta` and `thinking` (no per-event id) use category flags — `sawTextDelta`, `sawThinkingDelta` — set when `onDelta` emits them; the `run.stream()` complete-form is then skipped. `tool_call`/`tool_result` use **callId Sets** — `emittedToolCallIds`, `emittedToolResultIds` — populated as `onDelta` emits each; a `run.stream()` `tool_call`/`tool_result` is skipped ONLY when its `callId` is already in the matching Set. `run_started`/`error` are never skipped; `done` stays suppressed (real-usage `done` emitted after `run.wait()`).
- **Rationale:** A blanket `sawToolDelta` flag (v1.0) would suppress a `run.stream()` tool ERROR result whose callId `onDelta` only reported as `tool-call-started` (EC-1) — silently losing the failure and hanging the UI card. callId-based dedup skips only the exact `(category, callId)` pairs `onDelta` actually emitted, so a tool whose completion/error arrives only via `run.stream()` is still surfaced. Per-category-flag for text/thinking is correct because they have no id and the complete form equals the concatenated deltas. No assumption about provider behavior — FAANG, no silent data loss.
- **Alternatives considered:** (a) Blanket `sawToolDelta` flag (v1.0) — REJECTED per EC-1 (drops stream-only tool errors). (b) Dedup ALL categories by callId — REJECTED: text/thinking deltas carry no callId, so a flag is the only option there.
- **Consequences:** Enables safe coexistence of the two event sources with no lost tool errors. Constrains: the dedup state carries two Sets + two flags; kept in sync with the `StreamEvent` content categories.

### D4 — Extract `translateInteractionUpdate` into `event-translator.ts`
- **Decision:** Add a pure `translateInteractionUpdate(update: InteractionUpdate): StreamEvent[]` to `event-translator.ts` (mirroring `translateSdkEvent`), unit-tested in isolation. `sdk-adapter.ts`'s `onDelta` calls it.
- **Rationale:** Keeps `sdk-adapter.ts` under the 500-LoC G6 budget (currently 405) and makes the update→event mapping unit-testable without a fake Agent. DRY: reuses `serializeToolOutput` for tool-result output.
- **Alternatives considered:** Inline the translation in `onDelta` — REJECTED: pushes the adapter toward the LoC ceiling and makes the mapping only testable through the heavier integration path.
- **Consequences:** One new exported pure function (with its own unit tests, satisfying G7). Adapter stays lean.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Structural events (`run_started`, `done`) now arrive AFTER the content stream (they come from the post-completion `run.stream()`) | Low | Already the shipped #40 behavior; consumers (theocode) drop `run_started`/`done`; terminal usage via `realUsageDone`/`DelegationResult`. Documented; not in scope to synthesize `run_started` first. | agents |
| Double-emit if dedup misses a category | Medium | Per-category dedup (D3) + an explicit integration test asserting each content event appears exactly once when `onDelta` drives it AND when it does not | agents |
| Concurrent producer (onDelta) + producer (run.stream pump) into one queue | Medium | JS event loop serializes pushes (single-threaded); `createAsyncQueue` wake-on-push handles the interleave. Add a deterministic interleaved-order test + a "send resolves mid-drain, no event lost" test (see Concurrency tests) | agents |
| `send()` rejection path regresses (hang / undisposed agent) | Medium | Keep `agent` declared outside `try`; the pump's `finally` closes the queue; `await sendPromise` re-throws into the outer `catch` → `error` event + `finally` dispose. Explicit failure-scenario test. | agents |

## Unresolved Questions

- (none — every decision is resolved at plan time). The `InteractionUpdate` field shapes, `send()` semantics, and dedup contract are all verified against `@theokit/sdk` source with file:line citations in Prior Art.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | `^2.11.0` (installed) | npm | Runtime + the `InteractionUpdate` union (`types/updates.ts`) imported **type-only** for the new translator. Already a dependency; this plan adds no version change. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | No new runtime/dev dependency. The fix re-routes existing SDK callbacks; the only new import is a type-only `InteractionUpdate` from the already-installed `@theokit/sdk`. | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

## Dependency Graph

```
Phase 1 (pure translator + unit tests) ──▶ Phase 2 (adapter rewire + integration tests) ──▶ Phase 3 (Integration Validation)
```

Phase 1 is a prerequisite for Phase 2 (the adapter calls the new translator). Sequential — no parallelism (single coherent change across two files).

---

## Phase 1: Pure InteractionUpdate → StreamEvent translator

**Objective:** Add a unit-tested pure function mapping a single real-time `InteractionUpdate` to zero or more `StreamEvent`s.

### T1.1 — Add `translateInteractionUpdate` to event-translator.ts

#### Objective
A pure function `translateInteractionUpdate(update: InteractionUpdate): StreamEvent[]` that maps `text-delta`→`text_delta`, `tool-call-started`→`tool_call`, `tool-call-completed`→`tool_result`, `thinking-delta`→`thinking`; everything else → `[]`.

#### Why this step (action + reasoning)
1. **What this step does** — introduces the content-update translator in `event-translator.ts`, reusing `serializeToolOutput` for the tool-result output, alongside the existing `translateSdkEvent`.
2. **Why it is necessary now** — D4: the `onDelta` rewire in Phase 2 needs this mapping; extracting it here keeps `sdk-adapter.ts` under the G6 budget and makes the mapping unit-testable without a fake Agent. It must land BEFORE Phase 2 because the adapter imports it.

#### Evidence
- `InteractionUpdate` variants + field shapes: `@theokit/sdk` `packages/sdk/src/types/updates.ts:9` (`ToolCall { callId, name, args?, result? }`), `:21` (`TextDeltaUpdate { text }`), `:31` (`ThinkingDeltaUpdate { text }`), `:51` (`ToolCallStartedUpdate { callId, toolCall, modelCallId }`), `:75` (`ToolCallCompletedUpdate { callId, toolCall, modelCallId }`), `:166` (union).
- Template to mirror: `packages/agents/src/bridge/event-translator.ts:145` (`translateSdkEvent`) + `:26` (`serializeToolOutput`).

#### Files to edit
```
packages/agents/src/bridge/event-translator.ts — add translateInteractionUpdate (+ type-only import of InteractionUpdate from '@theokit/sdk'); export it
packages/agents/tests/unit/event-translator.test.ts — RED tests for each mapping, added first (TDD)
```

#### Deep file dependency analysis
- `event-translator.ts` today exports `translateSdkEvent` + `SdkMessage` + `serializeToolOutput` (used by `sdk-adapter.ts:mergeDeltaStream`). Adding `translateInteractionUpdate` is additive — no existing signature changes. The new function reuses `serializeToolOutput` (DRY).
- Downstream: `sdk-adapter.ts` (Phase 2) will import the new function. No other caller.

#### Deep Dives
- **Mapping table:**
  - `text-delta` → `[{ type:'text_delta', content: u.text }]` (skip when empty string)
  - `tool-call-started` → `[{ type:'tool_call', callId: u.callId, toolName: u.toolCall.name, input: u.toolCall.args ?? {} }]`
  - `tool-call-completed` → `[{ type:'tool_result', callId: u.callId, toolName: u.toolCall.name, output: serializeToolOutput(u.toolCall.result, ''), durationMs: 0, isError: false }]`
  - `thinking-delta` → `[{ type:'thinking', content: u.text }]` (skip when empty)
  - all others (`partial-tool-call`, `thinking-completed`, `token-delta`, `step-*`, `turn-ended`, `summary-*`, `shell-output-delta`) → `[]`
- **Invariants:** pure (no I/O, no mutation); narrow on the `type` discriminant (no `any`, no `as`-cast except narrowing the duck-typed union); `serializeToolOutput` reused unchanged.
- **Edge cases:** empty `text` → `[]`; `toolCall.args` undefined → `{}`; `toolCall.result` undefined → `''` (via fallback); unknown `type` → `[]`.

#### Pseudo-code / Signatures
```pseudocode
export function translateInteractionUpdate(u: InteractionUpdate): StreamEvent[]
  switch u.type
    case 'text-delta':          return u.text ? [textDelta(u.text)] : []
    case 'thinking-delta':      return u.text ? [thinking(u.text)] : []
    case 'tool-call-started':   return [toolCall(u.callId, u.toolCall.name, u.toolCall.args ?? {})]
    case 'tool-call-completed': return [toolResult(u.callId, u.toolCall.name, serializeToolOutput(u.toolCall.result, ''))]
    default:                    return []

# Example
input:  { type:'tool-call-started', callId:'c1', toolCall:{callId:'c1',name:'write_file',args:{path:'a.txt'}}, modelCallId:'m1' }
output: [{ type:'tool_call', callId:'c1', toolName:'write_file', input:{path:'a.txt'} }]
```

#### Tasks
1. Write RED unit tests for the five mappings + the "unknown type → []" + "empty text → []" cases.
2. Add the type-only `InteractionUpdate` import and `translateInteractionUpdate` implementation (GREEN).
3. Refactor: ensure `serializeToolOutput` is reused (no duplicated serialization).

#### TDD
```
RED:     test_translate_text_delta_emits_text_delta() — 'text-delta' {text:'hi'} → [{type:'text_delta',content:'hi'}]
RED:     test_translate_empty_text_delta_emits_nothing() — 'text-delta' {text:''} → []
RED:     test_translate_tool_call_started_emits_tool_call() — → [{type:'tool_call',callId,toolName,input}]
RED:     test_translate_tool_call_completed_serializes_result() — object result → JSON string in tool_result.output
RED:     test_translate_thinking_delta_emits_thinking() — 'thinking-delta' {text:'reason'} → [{type:'thinking',content:'reason'}]
RED:     test_translate_unknown_update_emits_nothing() — 'partial-tool-call'/'token-delta' → []
GREEN:   Implement translateInteractionUpdate
REFACTOR: Extract small toStreamEvent helpers only if it reduces duplication; else None expected
VERIFY:  pnpm --filter @theokit/agents test event-translator
```

#### Concurrency tests (only when applicable)

(none — single-threaded) — `translateInteractionUpdate` is a pure synchronous function with no shared state; no locks/async/queues touched.

#### Acceptance Criteria
- [ ] All six RED tests pass — `pnpm --filter @theokit/agents test event-translator` exits 0 with the 6 new tests green.
- [ ] Pass: complexity — `npx eslint packages/agents/src/bridge/event-translator.ts` reports zero complexity warnings (`translateInteractionUpdate` cyclomatic ≤ 10).
- [ ] Pass: coverage — `pnpm --filter @theokit/agents test -- --coverage` reports 100% branch coverage on `translateInteractionUpdate`.
- [ ] Pass: lint — `npx eslint packages/agents/src/bridge/event-translator.ts` exits 0 (zero warnings).
- [ ] Pass: size — `wc -l packages/agents/src/bridge/event-translator.ts` returns ≤ 500.

#### DoD
- [ ] All tasks completed and validated.
- [ ] `pnpm --filter @theokit/agents test event-translator` green.
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` zero errors.
- [ ] `npx eslint packages/agents` zero warnings on the touched file.
- [ ] File-size budget respected.

---

## Phase 2: Rewire the adapter — onDelta routing + concurrent consume + per-category dedup

**Objective:** `createSdkAgentStream` emits content events from `onDelta` in chronological order, consumed concurrently with `send()`, with per-category dedup and an unbroken fallback + error path.

### T2.1 — Route tool/thinking through onDelta, consume concurrently, dedup per category

#### Objective
Replace the `onDelta`-text-only + await-send-then-stream design with: `onDelta` routes all content updates (via `translateInteractionUpdate`) into the queue; the queue is consumed concurrently with `send()`; `run.stream()` provides structural events + the no-onDelta fallback with per-category dedup.

#### Why this step (action + reasoning)
1. **What this step does** — rewrites `onDelta` to call `translateInteractionUpdate` and set per-category flags; refactors `mergeDeltaStream` + `createSdkAgentStream` so `send()` is not awaited before draining (D2), and `translateSdkEvent` outputs are skipped per category (D3).
2. **Why it is necessary now** — this is the actual #44 fix. It depends on T1.1's translator (Phase 1 blocker). Doing it as one task keeps the queue contract coherent (changing the producer, the consumer dedup, and the await structure together — splitting them would leave an intermediate broken state).

#### Evidence
- Regression site: `packages/agents/src/bridge/sdk-adapter.ts:379` (`const run = await agent.send(...)` before consume at `:384`); `onDelta` text-only at `:370-378`; `mergeDeltaStream` at `:213-239`; `sawDelta` dedup at `:233`.
- `send()` is post-completion: `@theokit/sdk` `local-agent.ts:235-239`.
- Real-time tool/thinking available via `onDelta`: `@theokit/sdk` `types/updates.ts:166`.

#### Files to edit
```
packages/agents/src/bridge/sdk-adapter.ts — rewrite onDelta (call translateInteractionUpdate + set sawTextDelta/sawToolDelta/sawThinkingDelta); change mergeDeltaStream to consume queue while pump awaits the send promise then reads run.stream(); per-category skip; start send() unawaited; await it for run.wait()
packages/agents/tests/integration/sdk-adapter-streaming.test.ts — RED tests for chronological order, per-category dedup, no-onDelta fallback, send-rejection error path
```

#### Deep file dependency analysis
- `sdk-adapter.ts` today: `createSdkAgentStream` awaits `send()` (line 379) THEN consumes `mergeDeltaStream(run.stream(), ...)` (384). `onDelta` (370-378) forwards only `text-delta`; `state = { sawDelta, sawError }`. `mergeDeltaStream` starts a pump over the passed `stream` and yields queue items, deduping `text_delta` when `sawDelta`.
- This task: `onDelta` becomes content-complete (text+tool+thinking) via `translateInteractionUpdate`; `state` gains `sawToolDelta`/`sawThinkingDelta` (rename `sawDelta`→`sawTextDelta`); `mergeDeltaStream` signature changes to accept the queue + an `openStream` thunk (`async () => { await sendPromise; return run.stream() }`) so the pump can run concurrently with the consumer while `onDelta` fills the queue during `send()`.
- Downstream: 16 test callers exercise `createSdkAgentStream`. The emitted union is unchanged; only ORDER + dedup change. Tests asserting "all text then all tools" (if any) must be updated to the correct interleaved order; tests asserting the union/content stay green. `realUsageDone`, dispose, `SDK_NOT_INSTALLED`, RuntimeOverrides paths unchanged.

#### Deep Dives
- **State (D3 hybrid):** `{ sawTextDelta:false, sawThinkingDelta:false, emittedToolCallIds:Set<string>, emittedToolResultIds:Set<string>, sawError:false }`.
- **onDelta:** `for (const ev of translateInteractionUpdate(d.update)) { mark(ev, state); queue.push({kind:'delta', event: ev}) }` where `mark` sets `sawTextDelta`/`sawThinkingDelta` for those types and adds `ev.callId` to `emittedToolCallIds`/`emittedToolResultIds` for `tool_call`/`tool_result`.
- **Dedup skip predicate (run.stream path) — EC-1:** skip `text_delta` if `sawTextDelta`; skip `thinking` if `sawThinkingDelta`; skip `tool_call` if `emittedToolCallIds.has(out.callId)`; skip `tool_result` if `emittedToolResultIds.has(out.callId)`; never skip `run_started`/`error`; always skip `done` (real-usage `done` emitted after `run.wait()`).
- **Concurrency structure:**
  - `const sendPromise = agent.send(message, { onDelta })` (NOT awaited) — `onDelta` fills the queue during the run.
  - `mergeDeltaStream(queue, openStream, runId, state)` where `openStream = async () => { const run = await sendPromise; return run.stream() }`. Inside, a `pump` awaits `openStream()` then pushes `{kind:'sdk'}` msgs and `finally` closes the queue; the generator's `for await (item of queue)` yields concurrently.
  - After the loop: `const run = await sendPromise; if (!state.sawError) yield realUsageDone(await run.wait(), t0)`.
- **Invariants to preserve:** `SDK_NOT_INSTALLED` early-return; `finally { agent?.dispose() }`; `realUsageDone` exactly-one-terminal; RuntimeOverrides/conversationStorage (V4-L/V4-M); factory signature `(message, sessionId) => AsyncIterable<StreamEvent>` unchanged; file < 500 LoC.
- **Edge cases:** provider never drives `onDelta` → all flags false → `run.stream()` supplies everything in chronological complete-message order (pre-#40 correct behavior). `partial-tool-call` ignored (no duplicate cards). `send()` rejects → `openStream` await throws → pump `finally` closes queue → consumer ends → `await sendPromise` (or the propagated pump error) throws into outer `catch` → `error` event + dispose.

#### Pseudo-code / Signatures
```pseudocode
const sendPromise = agent.send(message, { onDelta })          // unawaited (D2)
const openStream = async () => (await sendPromise).stream()
for await (const ev of mergeDeltaStream(queue, openStream, runId, state)) yield ev
const run = await sendPromise
if (!state.sawError) yield realUsageDone(await run.wait(), t0)

async function* mergeDeltaStream(queue, openStream, runId, state):
  const pump = (async () => { try { for await (msg of await openStream()) queue.push({kind:'sdk',msg}) } finally { queue.close() } })()
  for await (item of queue):
    if item.kind == 'delta': yield item.event; continue
    for out in translateSdkEvent(item.msg, runId):
      if out.type == 'done': continue
      if skipDup(out.type, state): continue
      if out.type == 'error': state.sawError = true
      yield out
  await pump

# Example arrival via onDelta: text 'Vou' , tool-call-started write_file, tool-call-completed write_file, text 'Pronto'
# Emitted order: text_delta 'Vou', tool_call write_file, tool_result write_file, text_delta 'Pronto'  (interleaved — NOT all-text-then-all-tools)
```

#### Tasks
1. Write RED integration tests: chronological interleave; per-category dedup (no double-emit when onDelta drives a category; run.stream supplies it when onDelta does not); no-onDelta fallback; send-rejection → error event + dispose.
2. Add `translateInteractionUpdate` import; rewrite `onDelta` + `state` flags.
3. Change `mergeDeltaStream` signature to `(queue, openStream, runId, state)`; implement concurrent pump + per-category `skipDup`.
4. Rewire `createSdkAgentStream`: unawaited `send`, `openStream` thunk, concurrent consume, terminal `realUsageDone`.
5. Refactor: keep adapter < 500 LoC; extract `skipDup`/`markFlag` helpers if needed.

#### TDD
```
RED:     test_stream_emits_events_in_chronological_arrival_order() — fake Agent onDelta fires text→toolStart→toolComplete→text; emitted StreamEvent order == arrival order (no all-text-then-all-tools)
RED:     test_tool_events_from_onDelta_not_duplicated_by_run_stream() — onDelta drives tool-call-*; run.stream also yields the tool_call message; tool_call/tool_result each emitted exactly once
RED:     test_no_onDelta_provider_falls_back_to_run_stream_order() — Agent never calls onDelta; events come from run.stream() in complete-message chronological order
RED:     test_text_only_onDelta_still_gets_tools_from_run_stream() — onDelta drives only text-delta; tool_call/tool_result still emitted from run.stream() (no loss)
RED:     test_tool_error_from_run_stream_not_suppressed_when_onDelta_only_started() — EC-3: onDelta emits tool-call-started for callId X only; run.stream yields tool_call status:'error' for X; tool_result(isError:true) for X IS emitted (callId dedup, not blanket flag)
RED:     test_send_rejection_emits_error_and_disposes() — agent.send rejects; an error StreamEvent is yielded and dispose() is called
RED:     test_send_rejection_after_partial_deltas_emits_content_then_error() — EC-2: onDelta fires partial text/tool events, THEN send rejects; partial content yielded in order BEFORE terminal error; dispose runs
GREEN:   Implement the onDelta rewire + concurrent mergeDeltaStream + callId-based tool dedup (D3)
REFACTOR: Extract skipDup/mark helpers to keep sdk-adapter.ts < 500 LoC
VERIFY:  pnpm --filter @theokit/agents test sdk-adapter
```

#### Concurrency tests (only when applicable)
The queue now has two producers (the `onDelta` callback during `send()` and the `run.stream()` pump after) and one consumer running concurrently. JS is single-threaded (event-loop-serialized pushes), so the risk is lost-wakeup / event loss / ordering, not a data race.
```
test_concurrent_onDelta_and_pump_no_event_lost() — deterministic interleave: onDelta pushes K content events while send is pending, send resolves, pump pushes M structural events; assert all K+M surface, K content events in arrival order, none lost across the send-resolution boundary.
```
This is the "happens-before observation" shape: the fake Agent fires onDelta a known number of times, then resolves send (barrier), then the pump drains run.stream(); the test asserts on the fully-observed sequence. Deterministic (no real timers) → not flaky.

#### Acceptance Criteria
- [ ] All six T2.1 RED tests + the concurrency test pass — `pnpm --filter @theokit/agents test sdk-adapter` exits 0.
- [ ] Chronological-order proven — `pnpm --filter @theokit/agents test sdk-adapter -t "chronological_arrival_order"` exits 0 (the #44 metric).
- [ ] Pass: complexity — `npx eslint packages/agents/src/bridge/sdk-adapter.ts` reports zero complexity warnings (changed functions cyclomatic ≤ 10).
- [ ] Pass: coverage — `pnpm --filter @theokit/agents test -- --coverage` reports ≥ 90% on `sdk-adapter.ts` changed lines; order/dedup/fallback/error branches 100%.
- [ ] Pass: lint — `npx eslint packages/agents` exits 0 (zero warnings on touched files).
- [ ] Pass: size — `wc -l packages/agents/src/bridge/sdk-adapter.ts` returns ≤ 500.
- [ ] No public API change — `git diff packages/agents/src/bridge/index.ts` is empty AND the `createSdkAgentStream` signature is unchanged.

#### DoD
- [ ] All tasks completed and validated.
- [ ] `pnpm --filter @theokit/agents test` green (full suite — no regression in the 16 caller tests).
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` zero errors.
- [ ] `npx eslint packages/agents` zero warnings on touched files.
- [ ] File-size budget respected (`sdk-adapter.ts` < 500).
- [ ] CHANGELOG `[Unreleased]` updated.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Tool events emitted in chronological order interleaved with text (#44 core) | T2.1 | onDelta routes tool-call-started/completed (D1); chronological-order test |
| 2 | Pure, testable update→event mapping under G6 budget | T1.1 | `translateInteractionUpdate` in event-translator.ts (D4) |
| 3 | Thinking routed through onDelta (parallel ordering bug prevented) | T1.1, T2.1 | thinking-delta → thinking in translator + onDelta |
| 4 | Real-time delivery (consume concurrently with send) | T2.1 | unawaited send + concurrent queue consume (D2) |
| 5 | No double-emit; robust against partial onDelta support | T2.1 | hybrid dedup (D3); dedup tests |
| 6 | No-onDelta provider fallback unbroken | T2.1 | fallback test via run.stream() |
| 7 | send() rejection surfaces error + disposes | T2.1 | failure-scenario test (+ EC-2 partial-then-error) |
| 8 | No public API change; adapter < 500 LoC | T1.1, T2.1 | translator extracted; signature unchanged; `wc -l` check |
| 9 | EC-1: stream-only tool error not dropped by dedup | T2.1 | callId-based tool dedup (D3); EC-3 test |

**Coverage: 9/9 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed.
- [ ] All tests passing — `pnpm --filter @theokit/agents test` green.
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`.
- [ ] Zero lint warnings — `npx eslint packages/agents` on touched files.
- [ ] File-size budget respected — `sdk-adapter.ts` < 500, `event-translator.ts` < 500.
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6).
- [ ] Backward compatibility preserved — `StreamEvent` union + `createSdkAgentStream` signature unchanged; no-onDelta fallback intact.
- [ ] Plan-specific: chronological-order integration test green (the #44 metric); per-category dedup test green; send-rejection test green.
- [ ] **Runtime-metric proof** — n/a (no new counter; the behavioral proof is the chronological-order integration test, exercised in the suite).
- [ ] **Plan archived** — after `/review` = READY_TO_MERGE AND PR merged, move this plan to `knowledge-base/plans/completed/`.

## Failure scenarios (when I/O external)

The adapter calls `@theokit/sdk` `agent.send()` / `run.stream()` / `run.wait()` (the runtime boundary). In tests these are driven by a fake Agent (no real network), but the rejection path is a real production failure mode.

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `@theokit/sdk` `agent.send()` | promise rejects (provider/auth/network error mid-run) | fake Agent whose `send` returns a rejected promise | `mergeDeltaStream` pump's `finally` closes the queue; the rejection propagates to the outer `catch`; an `error` `StreamEvent` is yielded; `agent.dispose()` runs in `finally`; no hang |
| `@theokit/sdk` `run.stream()` | generator throws mid-iteration | fake Agent whose `stream()` throws after N msgs | pump `finally` closes queue; `await pump` re-throws into outer `catch` → `error` event + dispose |
| `@theokit/sdk` not installed | dynamic `import('@theokit/sdk')` throws | (existing test) | `SDK_NOT_INSTALLED` error event, early return (unchanged) |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the fix in the full agents suite — not just the new tests.

### Execution
```
pnpm --filter @theokit/agents test                                  # full unit + integration suite
npx tsc --noEmit -p packages/agents/tsconfig.test.json              # zero type errors
npx eslint packages/agents                                          # lint (touched files zero warnings)
wc -l packages/agents/src/bridge/sdk-adapter.ts                      # < 500 (G6)
```

### Acceptance Criteria
- [ ] All test suites green — `pnpm --filter @theokit/agents test` exits 0 (the 16 caller tests + new tests).
- [ ] Coverage ≥ 90% — `pnpm --filter @theokit/agents test -- --coverage` reports ≥ 90% on changed files; order/dedup/fallback/error branches 100%.
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exits 0.
- [ ] Zero lint warnings — `npx eslint packages/agents` exits 0 on touched files.
- [ ] Failure scenarios green — `pnpm --filter @theokit/agents test sdk-adapter -t "rejection"` exits 0 (send-rejection + stream-throw rows exercised).
- [ ] Chronological-order green — `pnpm --filter @theokit/agents test sdk-adapter -t "chronological_arrival_order"` exits 0 (the #44 acceptance metric).

### If Validation Fails
1. Separate plan-caused failures from pre-existing (the 30 pre-existing eslint errors in untouched agents test files are documented baseline — not caused here).
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Pre-existing issues logged in the PR description, do not block.
