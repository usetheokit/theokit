---
slug: agents-stream-dx-fixes
created_at: 2026-06-28
goal: Fix the three @theokit/agents streaming-DX defects (#40 token streaming, #41 tool output, #42 tool_call running) so SSE consumers get incremental token deltas, populated tool results, and a running tool card.
---

# Plan: agents-stream-dx-fixes — token streaming + tool output + tool_call running (#40/#41/#42)

> **Version 1.0** — Fix the three streaming-DX defects in `@theokit/agents` reported as usetheodev/theokit#40/#41/#42, diagnosed empirically against the theocode reference app. All three live at the SDK↔agents bridge (`packages/agents/src/bridge/`), the only "ponte" code permitted by `sdk-runtime.md`/G2. The SDK already exposes everything needed (token deltas via `SendOptions.onDelta` — proven empirically; tool result in `msg.result`); the bridge just discards it. Fixes: (#40) pass `onDelta` to `agent.send` and merge the deltas into the stream, deduping against the complete `assistant` message; (#41) serialize non-string tool `result` instead of dropping it; (#42) emit a `tool_call` StreamEvent on the `running` status so the UI shows the running card. Oracles: new TDD tests RED→GREEN; full `@theokit/agents` suite green; `tsc` 0; lint 0.

## Goal

> "Make `createSdkAgentStream` emit incremental `text_delta` events during generation, populate `tool_result.output` for object results, and emit a `tool_call` event on tool start — measured by: 3 new/updated TDD tests pass (incremental deltas, serialized tool output, running tool_call), the full `pnpm --filter @theokit/agents test` suite stays green, and `tsc --noEmit` + `eslint` are 0."

## Context

The theocode reference app surfaced a "spinner stuck → everything at once, no tool output" DX. Empirical diagnosis (curl SSE + isolated SDK probes) proved three defects, all in `@theokit/agents`' SDK bridge:

1. **#40 — no token streaming.** `createSdkAgentStream` calls `agent.send(message)` WITHOUT `onDelta` and consumes only `run.stream()`, which emits complete `assistant` messages — never token deltas. The SDK DOES stream tokens via `SendOptions.onDelta` (proven: 30 incremental deltas over 800ms in an isolated probe). `translateSdkEvent` has no `text_delta` case, so even if deltas reached it they'd be dropped.
2. **#41 — tool output discarded.** `translateToolCallEvent` does `output: asString(msg.result, '')`; `asString` returns the fallback for non-strings, so object results (`{ ok, files }`) become `''`.
3. **#42 — no running tool_call.** `translateToolCallEvent` returns `[]` for the `running` status, so no `tool_call` event is emitted at tool start — the UI never shows a "running" card with args.

This is consistent with `sdk-runtime.md` (the SDK is the runtime; the bridge is the only adapter code) and G2 — the fix is purely in the bridge, not a re-implementation. Build under test: `@theokit/agents@0.21.0`, `@theokit/sdk@2.11.0`.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC | Role today | Invariants to preserve |
|---|---|---|---|
| `packages/agents/src/bridge/event-translator.ts` | 140 | `translateSdkEvent` + per-type translators | `translateAssistantEvent` stays (becomes the streaming FALLBACK); only `translateToolCallEvent` changes (#41 serialize, #42 running) |
| `packages/agents/src/bridge/sdk-adapter.ts` | 308 | `createSdkAgentStream` — calls `agent.send` + consumes `run.stream()` | duck-typed SDK import shape extended for `send(msg, opts?)`; G6 ≤500 LoC/file, ≤50 LoC/fn; the V4-N realUsageDone terminal + dispose path unchanged |
| `packages/agents/tests/unit/event-translator.test.ts` | — | translator unit tests | `test_tool_call_running_emits_nothing` (line 100) encodes the #42 BUG — it is INVERTED by this fix; the string-output cases (line 54/78) keep passing (string passthrough) |
| `packages/agents/tests/integration/sdk-adapter-translation.test.ts` (or a new adapter test) | — | adapter-level translation via a fake SDK Agent | new tests assert incremental-delta ordering + dedup + serialized tool output |
| `CHANGELOG.md` | — | — | `[Unreleased] § Fixed` entries for #40/#41/#42 |

### Current callers / dependents

- `createSdkAgentStream` (sdk-adapter.ts) is the production stream factory; consumed by `AgentRunner` (`agent-runner.ts` → `runner.stream()`). The theocode app consumes the resulting `StreamEvent`s via `runner.stream()`.
- `translateSdkEvent`/`translateToolCallEvent`/`translateAssistantEvent` (event-translator.ts) — called only from `sdk-adapter.ts` (line 284) and the unit tests.
- `StreamEvent` (agent-sse-handler.ts:10) — open `{ type: string; [k]: unknown }`; the typed variants live in `agent-stream-events.ts` (`ToolCallEvent` needs `callId`/`toolName`/`input`; `ToolResultEvent.output` is **`string`** — #41 must SERIALIZE, not change the type).
- The SDK `agent.send(message, options?)` accepts `SendOptions.onDelta((d) => …)` where `d.update.text` is the incremental token (proven empirically: `node --env-file=.env` probe → 30 deltas; without onDelta → 0 text_delta, all events batched).

### Domain glossary

- **bridge / adapter** — `packages/agents/src/bridge/`: the ONLY code allowed to translate between the SDK runtime and TheoKit `StreamEvent`s (`sdk-runtime.md`).
- **`onDelta`** — SDK `SendOptions` callback invoked per token delta during `agent.send`; the token-streaming source the bridge currently ignores.
- **delta-dedup** — when token deltas are emitted via `onDelta`, the complete `assistant` message's text must NOT be re-emitted as a `text_delta` (else the text duplicates). The bridge tracks "saw a delta" and filters the assistant `text_delta` accordingly; `translateAssistantEvent` stays the fallback when `onDelta` never fired.

### Architecture boundaries affected

`sdk-runtime.md` + G2 (SDK is the only runtime; bridge is the only ponte) — the fix is bridge-only, no LLM/loop re-implementation. `type-safety.md`/G3 (no `any`, no `as` except narrowing `unknown`; no `@ts-ignore`). G6 (file/function size budgets). `testing.md` (TDD RED-GREEN, BDD Given-When-Then). G8 (Web Standards). Dependency direction (G1) unchanged — no new cross-package import.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | 2.11.0 (peer) | npm | provides `agent.send(msg, { onDelta })` + `msg.result` — both already shipped; no SDK change needed |
| `vitest` | (dev) | npm | TDD test runner |
| `typescript` | (dev) | npm | `tsc --noEmit` gate |

### New — to be introduced
(none — bridge-only fix; the SDK already exposes `onDelta` + `msg.result`.)
### Removed
(none)

## Prior Art & Related Work

- **In-repo:** `agent-stream-events.ts` (`TextDeltaEvent`, `ToolCallEvent`, `ToolResultEvent` typed variants) is the target event vocabulary; `runner-stream-factory.test.ts` + `sdk-adapter-translation.test.ts` show the fake-SDK-Agent test pattern to reuse.
- **In-repo rules:** `sdk-runtime.md` (bridge-only), G2 (no runtime re-impl) — this fix is the canonical "adapter forwards more of what the SDK already produces".
- **Empirical:** the isolated SDK probes (`sdk-diag.mjs` → 0 deltas without onDelta; `sdk-diag2.mjs` → 30 incremental deltas WITH onDelta) — the proof the SDK token-streams and the bridge just needs to consume it.
- **External:** async-iterator + callback merge (the classic "push callback into an async queue, drain in the for-await loop") — Node streams `Readable.from` / `events.on` pattern.

## Objective

- [ ] #41: `translateToolCallEvent` serializes non-string `msg.result` into `output` (string passthrough preserved); failed-tool path likewise.
- [ ] #42: `translateToolCallEvent` emits a `tool_call` StreamEvent on the `running` status (callId + toolName + input); the BUG-encoding test is inverted.
- [ ] #40: `createSdkAgentStream` passes `onDelta` to `agent.send`, merges incremental `text_delta` events into the stream in arrival order, and dedups the complete-assistant text so it is not double-emitted (with a fallback when `onDelta` never fires).
- [ ] `pnpm --filter @theokit/agents test` green · `tsc --noEmit` 0 · `eslint` 0 · CHANGELOG updated.

## ADRs

### D1 — #41: serialize non-string tool results (do not change `ToolResultEvent.output` type)
- **Decision:** Add a `serializeToolOutput(result, fallback)` helper: `string` → passthrough; `null`/`undefined` → fallback; else `JSON.stringify` (try/catch → `String(result)`). Use it in both `completed` and `error` branches of `translateToolCallEvent`.
- **Rationale:** `ToolResultEvent.output` is typed `string` (agent-stream-events.ts:28) — the wire contract is a string. Serializing preserves the contract while stopping data loss. KISS; mirrors the existing defensive `safeStringify` pattern in theocode. `type-safety.md` — no `any`, the helper takes `unknown`.
- **Alternatives considered:** (a) change `output` to `unknown` — REJECTED: breaks the `StreamEvent` wire contract + every consumer; bigger blast radius. (b) keep `asString` — REJECTED: it is the bug. (c) add a separate `data` field for the object — REJECTED: YAGNI; the string output already round-trips JSON for structural consumers (theocode `safeParse`s it).
- **Consequences:** object tool results reach the UI as JSON strings (theocode parses them); string results unchanged (existing tests pass).

### D2 — #42: emit `tool_call` on the running status; keep `translateAssistantEvent`'s tool_use path
- **Decision:** In `translateToolCallEvent`, the `running` status returns `[{ type: 'tool_call', callId, toolName, input: msg.input ?? msg.arguments ?? {} }]` instead of `[]`. The bug-encoding test `test_tool_call_running_emits_nothing` is updated to `test_tool_call_running_emits_tool_call`.
- **Rationale:** the running card needs a `tool_call` at tool START with the args; the SDK emits a `SDKToolUseMessage` with `status:'running'` carrying the input. `testing.md` — the test that codified the bug is rewritten to assert the correct behavior.
- **Alternatives considered:** (a) emit the `tool_call` only from `translateAssistantEvent`'s `tool_use` block — REJECTED: empirically the SDK sends tool calls as separate `tool_call` messages (status running→completed), and the final `assistant` text message carries no `tool_use` block, so that path never fires for the real provider flow. (b) dedup tool_call across both paths — deferred: the two SDK formats are mutually exclusive in practice (documented as a Drawback to watch).
- **Consequences:** the UI shows running→success/failed; correlated by `callId` (already the consumer's join key).

### D3 — #40: pass `onDelta`, merge deltas via an async queue, dedup the complete-assistant text in the adapter
- **Decision:** In `createSdkAgentStream`: (a) build an async delta queue; `onDelta = (d) => queue.push({ type:'text_delta', content: d.update.text })`; pass it to `agent.send(message, { onDelta })`; (b) drain the queue + `run.stream()` so deltas are yielded in arrival order; (c) track `sawDelta`; when a translated `assistant` event would emit a `text_delta` AND `sawDelta` is true, the adapter FILTERS that `text_delta` (keeps tool_call/others) — preventing duplication. `translateAssistantEvent` is UNCHANGED (stays the fallback when `onDelta` never fired). Extend the duck-typed `agent.send` import shape to `(msg: string, opts?: { onDelta?: (d: { update: { text: string } }) => void }) => …`.
- **Rationale:** the SDK token-streams ONLY via `onDelta` (proven); merging is the minimal bridge change. Keeping the dedup in the adapter keeps `translateAssistantEvent` pure + testable + a robust fallback (if a provider never calls `onDelta`, the complete-assistant text still ships). `sdk-runtime.md`/G2 — bridge-only, no runtime re-impl. G6 — extract the merge into a helper to keep the generator ≤50 LoC.
- **Alternatives considered:** (a) make `translateAssistantEvent` stop emitting text_delta unconditionally — REJECTED: loses the fallback; a provider without `onDelta` would emit no text at all. (b) re-emit the assistant text and let the client dedup — REJECTED: pushes framework bugs onto every consumer. (c) consume a hypothetical SDK `text_delta` event in `translateSdkEvent` — REJECTED: empirically `run.stream()` does NOT emit `text_delta` (only `onDelta` does). (d) a third-party merge lib — REJECTED: ~20 lines of queue code; no new dep (G2/Rule 9 proportionality).
- **Consequences:** incremental token streaming end-to-end; the complete-assistant text is deduped; the fallback preserves correctness for non-streaming providers.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Delta/assistant double-emission (text duplicates) | **High** | D3 dedup: filter the assistant `text_delta` when `sawDelta`; an integration test asserts the final text appears once | impl |
| `onDelta` never fires for some provider → no text | Medium | Fallback: `translateAssistantEvent` still emits the complete text when `sawDelta` is false; test the no-delta path | impl |
| Merge ordering races (deltas vs tool events) | Medium | Single async generator drains the queue in arrival order before/around each `run.stream()` step; deterministic test with a fake Agent driving both | impl |
| #42 tool_call duplicated if the SDK ALSO sends a tool_use block in the assistant | Medium | D2: empirically the two formats are mutually exclusive; if a future provider sends both, dedup by `callId` in the adapter (documented; add a guard test if observed) | impl |
| Generator exceeds G6 50-LoC budget | Low | Extract the merge loop into a helper (mirrors `realUsageDone`/`buildExtraCreateOptions`) | impl |
| Tool `input` absent on the running SDK message → empty args card | Low | `input: msg.input ?? msg.arguments ?? {}`; the completed `tool_result` still carries the output | impl |

## Unresolved Questions

- Q1 — Does the SDK ever emit BOTH a `tool_use` block in the assistant AND a separate `tool_call` message for the same call? Resolved at plan time per the empirical probe (separate `tool_call` messages; assistant text-only) — D2 keeps both paths but notes the dedup-by-callId contingency. `(none — every decision is resolved at plan time)`.

## Dependency Graph

```
Phase 1: T1.1 (#41 serialize) + T1.2 (#42 running) — event-translator.ts (independent, simple)
      ↓
Phase 2: T2.1 (#40 streaming merge + dedup) — sdk-adapter.ts (depends on the StreamEvent vocab; builds on Phase 1's tool events)
      ↓
Phase 3: T3.1 (verify: full suite + tsc + lint + CHANGELOG)
```

---

## Phase 1: event-translator fixes (#41, #42)

### T1.1 — #41: serialize non-string tool results

#### Objective
`translateToolCallEvent` must put the real tool output (object → JSON) into `tool_result.output`, not `''`.

#### Why this step (action + reasoning)
1. **What this step does** — adds `serializeToolOutput(result, fallback)` and replaces `asString(msg.result, '')`/`asString(msg.result, 'Tool failed')` with it in the `completed`/`error` branches.
2. **Why it is necessary now** — it is defect #41; per D1 serializing preserves the `string` wire contract while stopping the data loss; per Baseline the UI renders nothing without it.

#### Evidence
event-translator.ts:69,81 (`asString(msg.result, …)`); agent-stream-events.ts:28 (`output: string`); empirical SSE (`data:""`).

#### Files to edit
```
packages/agents/src/bridge/event-translator.ts — add serializeToolOutput; use it in translateToolCallEvent
packages/agents/tests/unit/event-translator.test.ts — add object-result serialization test (string cases stay green)
```

#### Deep file dependency analysis
- `serializeToolOutput(value: unknown, fallback: string): string` — pure; no new import. `translateAssistantEvent`/`translateSystemEvent`/`translateStatusEvent` unchanged.

#### Deep Dives
- `string` → passthrough (keeps `test_tool_call_completed_uses_call_id` green: `result:'ok'` → `'ok'`). `null`/`undefined` → fallback. else `JSON.stringify` in try/catch → `String(value)` on throw (BigInt/circular).

#### Pseudo-code / Signatures
```typescript
function serializeToolOutput(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return fallback
  try { return JSON.stringify(value) } catch { return String(value) }
}
// completed: output: serializeToolOutput(msg.result, '')
// error:     output: serializeToolOutput(msg.result, 'Tool failed')
```

#### Tasks
1. Add `serializeToolOutput`; wire into both branches.
2. Add the object-serialization test.

#### TDD
```
RED:     new test_tool_call_completed_serializes_object_result — { status:'completed', result:{ok:true,files:['a']} } expects output JSON '{"ok":true,"files":["a"]}'. Fails today (asString → '').
GREEN:   serializeToolOutput → test passes; existing string tests stay green.
REFACTOR: None.
VERIFY:  pnpm --filter @theokit/agents test event-translator
```

#### Concurrency tests (only when applicable)
(none — single-threaded)
Pure synchronous translation; no shared state.

#### Acceptance Criteria
- [ ] Object result serialized — `pnpm --filter @theokit/agents test -t serializes_object_result` exits 0
- [ ] String result unchanged — `pnpm --filter @theokit/agents test -t test_tool_call_completed_uses_call_id` exits 0
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exits 0
- [ ] Pass: lint — `npx eslint packages/agents/src/bridge/event-translator.ts` exits 0

#### DoD
- [ ] `serializeToolOutput` used in both branches; tests green; tsc + lint 0

---

### T1.2 — #42: emit `tool_call` on the running status

#### Objective
`translateToolCallEvent` must emit a `tool_call` StreamEvent when a tool starts (status `running`), so the UI shows the running card with args.

#### Why this step (action + reasoning)
1. **What this step does** — replaces the `running` `return []` with `return [{ type: 'tool_call', callId, toolName, input: msg.input ?? msg.arguments ?? {} }]`; inverts the bug-encoding test.
2. **Why it is necessary now** — it is defect #42; per D2 the running card needs the start event; per Baseline no `tool_call` reaches the consumer today.

#### Evidence
event-translator.ts:87 (`return [] // 'running' status → no event`); agent-stream-events.ts:15 (`ToolCallEvent` shape); test line 100 (`test_tool_call_running_emits_nothing` — encodes the bug); empirical SSE (no tool_call).

#### Files to edit
```
packages/agents/src/bridge/event-translator.ts — running branch emits tool_call
packages/agents/tests/unit/event-translator.test.ts — invert test_tool_call_running_emits_nothing → emits tool_call
```

#### Deep file dependency analysis
- The `running` `SDKToolUseMessage` carries `call_id`, `name`, and `input`/`arguments`. `ToolCallEvent` requires `callId`/`toolName`/`input`. No new import.

#### Deep Dives
- `input: msg.input ?? msg.arguments ?? {}` (the SDK field name confirmed against the assistant `tool_use` path which uses `b.input`). The `completed`/`error` branches (tool_result) are unchanged except for #41.

#### Pseudo-code / Signatures
```typescript
if (status === 'running') {
  return [{ type: 'tool_call', callId, toolName, input: msg.input ?? msg.arguments ?? {} }]
}
```

#### Tasks
1. Replace the `running` return.
2. Invert the test to assert the `tool_call`.

#### TDD
```
RED:     rewrite test_tool_call_running_emits_nothing → test_tool_call_running_emits_tool_call — { type:'tool_call', status:'running', call_id:'c1', name:'glob', input:{p:'*'} } expects [{ type:'tool_call', callId:'c1', toolName:'glob', input:{p:'*'} }]. Fails today (returns []).
GREEN:   running branch emits tool_call → test passes.
REFACTOR: None.
VERIFY:  pnpm --filter @theokit/agents test event-translator
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] Running emits tool_call — `pnpm --filter @theokit/agents test -t running_emits_tool_call` exits 0
- [ ] Completed still emits tool_result — `pnpm --filter @theokit/agents test -t test_tool_call_completed_uses_call_id` exits 0
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exits 0
- [ ] Pass: lint — `npx eslint packages/agents/src/bridge/event-translator.ts` exits 0

#### DoD
- [ ] Running status emits a `tool_call`; bug-test inverted; tests green; tsc + lint 0

---

## Phase 2: streaming merge (#40)

### T2.1 — #40: pass `onDelta`, merge incremental deltas, dedup the complete-assistant text

#### Objective
`createSdkAgentStream` must emit `text_delta` events incrementally during generation (via `onDelta`), merged with `run.stream()`'s tool events, deduping the complete-assistant text.

#### Why this step (action + reasoning)
1. **What this step does** — builds an async delta queue, passes `onDelta` to `agent.send`, drains queue+`run.stream()` in arrival order, and filters the assistant `text_delta` when deltas were already emitted (`sawDelta`), with a fallback when `onDelta` never fired. Extends the duck-typed `agent.send` shape.
2. **Why it is necessary now** — it is defect #40 (the worst DX); per D3 the SDK token-streams only via `onDelta`; per Baseline `run.stream()` alone batches everything.

#### Evidence
sdk-adapter.ts:277 (`agent.send(message)` no onDelta), :283-289 (loop over run.stream()), :189 (duck-typed send shape); empirical probes (0 deltas without onDelta; 30 with).

#### Files to edit
```
packages/agents/src/bridge/sdk-adapter.ts — onDelta + async queue + merge helper + sawDelta dedup; extend send() type
packages/agents/tests/integration/sdk-adapter-translation.test.ts (or new sdk-adapter-streaming.test.ts) — fake Agent driving onDelta + run.stream(); assert incremental order + dedup + no-delta fallback
```

#### Deep file dependency analysis
- The fake SDK Agent in tests must expose `send(msg, opts)` that (a) invokes `opts.onDelta` with token chunks, then (b) returns a `run` whose `stream()` yields the complete `assistant` message + tool messages + status, and `wait()` returns usage. This exercises the merge + dedup deterministically without a real LLM.
- Production `agent.send` extended type: `(msg: string, opts?: { onDelta?: (d: { update: { text: string } }) => void }) => Promise<{ stream; wait }>`. No `any`; `unknown`-narrowed where needed.

#### Deep Dives
- Async queue: a minimal push/pull queue (resolver-array) — `push(ev)` enqueues + wakes a waiter; the merge loop `await`s either a queued delta or the next `run.stream()` item. Extract to a `mergeDeltaStream(run, queue, …)` helper to keep the generator ≤50 LoC (G6).
- Dedup: a `sawDelta` flag set in `onDelta`. In the translate loop, if an event is `text_delta` AND `sawDelta` is true, skip it (the deltas already carried that text). Keep tool_call/tool_result/done. `translateAssistantEvent` stays pure (the filter is in the adapter).
- Fallback: when `onDelta` never fires (`sawDelta` false), the assistant `text_delta` from `translateAssistantEvent` is emitted normally → no text loss.
- Ordering: deltas are flushed as they arrive; the complete-assistant message arrives at end-of-turn and its (now-duplicate) text_delta is filtered. Tool events from `run.stream()` are interleaved by arrival.

#### Pseudo-code / Signatures
```typescript
const queue = createAsyncQueue<StreamEvent>()
let sawDelta = false
const onDelta = (d: { update: { text: string } }) => {
  if (d.update.text) { sawDelta = true; queue.push({ type: 'text_delta', content: d.update.text }) }
}
const run = await agent.send(message, { onDelta })
// merge: yield queued deltas as they arrive, interleaved with translated run.stream() events;
// when translating an SDK event, drop text_delta results if sawDelta (dedup); keep the rest.
for await (const ev of mergeDeltaStream(run.stream(), queue)) {
  for (const out of translateSdkEvent(ev, runId)) {
    if (out.type === 'done') continue
    if (out.type === 'text_delta' && sawDelta) continue   // dedup — already streamed via onDelta
    if (out.type === 'error') sawError = true
    yield out
  }
}
// queued deltas that translate to text_delta are yielded directly (already StreamEvents)
```

#### Tasks
1. Add the async queue + `mergeDeltaStream` helper.
2. Pass `onDelta`; wire `sawDelta` dedup; extend the `send` type.
3. Add the fake-Agent integration test (incremental order + dedup + no-delta fallback).
4. `tsc` + lint + run the suite.

#### TDD
```
RED:     new sdk-adapter streaming test — a fake Agent calls onDelta('Hel'),onDelta('lo') then run.stream() yields the complete assistant {content:'Hello'} + a tool_call(running)+tool_result(completed) + status FINISHED. Expects the adapter to yield text_delta 'Hel', text_delta 'lo', tool_call, tool_result, done — and NOT a third text_delta 'Hello' (deduped). Fails today (no onDelta → only the batched 'Hello' + empty tool output).
GREEN:   onDelta + merge + dedup → test passes; a second test with NO onDelta asserts the fallback emits 'Hello' once.
REFACTOR: extract mergeDeltaStream to satisfy G6.
VERIFY:  pnpm --filter @theokit/agents test sdk-adapter && npx tsc --noEmit
```

#### Concurrency tests (only when applicable)
(none — single-threaded)
The async queue is single-consumer/single-producer within one JS event loop (no parallel threads); the merge is deterministic given the fake Agent's scripted callback+stream order. The race-shaped concern (delta vs stream ordering) is covered by the deterministic integration test, not a thread race.

#### Acceptance Criteria
- [ ] Incremental deltas — `pnpm --filter @theokit/agents test -t streams_incremental_deltas` exits 0 (asserts ≥2 text_delta before the tool/done events)
- [ ] Dedup — the same test asserts the complete-assistant text is NOT re-emitted (exactly the delta count, no extra full-text event)
- [ ] Fallback — `pnpm --filter @theokit/agents test -t no_delta_fallback_emits_full_text` exits 0
- [ ] Tool output populated end-to-end — the streaming test's tool_result.output is the serialized object (Phase 1 integration)
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exits 0 · `npx eslint packages/agents/src/bridge/sdk-adapter.ts` exits 0

#### DoD
- [ ] onDelta wired + merge + dedup + fallback; new tests green; `realUsageDone` terminal + dispose unchanged; tsc + lint 0; generator ≤50 LoC (G6)

---

## Phase 3: Verification (Integration Validation)

### T3.1 — Prove the three fixes together + no regression

#### Objective
Full `@theokit/agents` suite green with the three fixes; tsc + lint 0; CHANGELOG updated.

#### Why this step (action + reasoning)
1. **What this step does** — runs the whole suite + type/lint gates + writes the CHANGELOG.
2. **Why it is necessary now** — the three fixes touch the shared bridge; the full suite proves no regression to the 239+ existing agents tests (G-checklist).

#### Evidence
G "Quality Gate Checklist" — `pnpm --filter @theokit/agents test` (239+), eslint max-warnings 0, tsc 0.

#### Files to edit
```
(none — verification only)
CHANGELOG.md — [Unreleased] § Fixed: #40 token streaming, #41 tool output, #42 running tool_call
```

#### Deep file dependency analysis
- No source change; reads the post-Phase tree + adds CHANGELOG.

#### Deep Dives
- Invariant: existing test count holds (only the #42 bug-test is rewritten, not removed); new tests added; no test skipped.

#### Tasks
1. Run the validation chain; fix any regression.
2. Write the CHANGELOG entries (reference #40/#41/#42).

#### TDD
```
RED:     n/a (verification)
GREEN:   full suite + gates green
REFACTOR: None
VERIFY:  pnpm --filter @theokit/agents test && npx tsc --noEmit -p packages/agents/tsconfig.test.json && npx eslint packages/agents --max-warnings=0
```

#### Concurrency tests (only when applicable)
(none — single-threaded)

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test` exits 0 (full suite, no skips; existing 239+ plus new)
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` exits 0
- [ ] `npx eslint packages/agents --max-warnings=0` exits 0
- [ ] CHANGELOG updated — `grep -n "#40\|#41\|#42" CHANGELOG.md` shows the Fixed entries

#### DoD
- [ ] Full suite + tsc + lint green; CHANGELOG references the three issues

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | #41 tool output discarded (`asString` drops objects) | T1.1 | `serializeToolOutput` (JSON for objects, string passthrough) |
| 2 | #42 no running tool_call (running → `[]`) | T1.2 | running status emits `tool_call`; bug-test inverted |
| 3 | #40 no token streaming (`send` without onDelta) | T2.1 | onDelta + async-queue merge + sawDelta dedup + fallback |
| 4 | No regression to existing agents behavior + gates | T3.1 | full suite + tsc + lint green; CHANGELOG |

**Coverage: 4/4 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] #40/#41/#42 fixed in the bridge only (`event-translator.ts` + `sdk-adapter.ts`); no SDK change; no runtime re-impl (G2/sdk-runtime)
- [ ] `pnpm --filter @theokit/agents test` green · `tsc --noEmit` 0 · `eslint --max-warnings=0` 0
- [ ] New/updated TDD tests: serialize-object-output, running-emits-tool_call, incremental-deltas+dedup, no-delta-fallback
- [ ] CHANGELOG.md `[Unreleased] § Fixed` references #40/#41/#42
- [ ] Type-safety: no `any`/`as`(non-narrowing)/`@ts-ignore`; G6 size budgets honored
- [ ] Backward compatibility: `translateAssistantEvent` unchanged (fallback); `ToolResultEvent.output` stays `string`; `realUsageDone` terminal + dispose unchanged
- [ ] **Plan archived** after `/review` READY_TO_MERGE + merge

## Failure scenarios (when I/O external)

The bridge consumes the SDK `agent.send`/`run.stream()` (the SDK owns the LLM I/O — `sdk-runtime.md`). Failure modes the fix must not regress:

- **SDK not installed** — the existing `SDK_NOT_INSTALLED` error path (sdk-adapter.ts:221-228) is preserved unchanged.
- **`run.wait()` rejects** — the existing `finally { agent?.dispose() }` (LOW-1) path is preserved; the merge must not swallow the error (error events still set `sawError` and short-circuit the real-usage `done`).
- **`onDelta` never called (non-streaming provider)** — fallback: the complete-assistant `text_delta` is emitted (no text loss). Covered by the `no_delta_fallback` test.
- **Tool throws / returns error** — `translateToolCallEvent` `error` branch serializes `msg.result` (D1) with `isError:true`; unchanged otherwise.

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Prove the three fixes compile, the full suite passes, and the streaming/tool behavior is correct end-to-end at the bridge.

### Execution
```
pnpm --filter @theokit/agents test
npx tsc --noEmit -p packages/agents/tsconfig.test.json
npx eslint packages/agents --max-warnings=0
grep -n "#40\|#41\|#42" CHANGELOG.md
```

### Acceptance Criteria
- [ ] full suite green (no skips; existing 239+ plus the new tests) · tsc 0 · eslint 0
- [ ] streaming test proves incremental deltas + dedup + fallback; tool tests prove serialized output + running tool_call
- [ ] Diff is bridge-only (`event-translator.ts` + `sdk-adapter.ts`) + tests + CHANGELOG (no SDK change, no runtime re-impl)
- [ ] Runtime-metric proof — the adapter's existing `[THEO_AGENT_M8_RUNTIME_APPLIED]` debug log is unchanged · Failure scenarios — covered above

### If Validation Fails
1. Text duplicated → the dedup filter (`sawDelta`) is not catching the assistant text_delta; assert the filter runs before yield.
2. No deltas → `onDelta` not threaded into `agent.send`; verify the extended send type + the call site.
3. A pre-existing test broke → the merge changed event ordering; restore arrival-order semantics (deltas flush as they arrive; complete-assistant filtered).
