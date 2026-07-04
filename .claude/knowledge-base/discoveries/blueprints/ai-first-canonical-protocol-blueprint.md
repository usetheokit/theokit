# Blueprint: AI-First Canonical Protocol (M1)

> **Exec summary.** M1 extends the M0 text-only `translateToUIMessageStream`
> (`packages/agents/src/bridge/ui-message-stream-translator.ts:36`) to the FULL
> agent part set — **tool-call → tool-result → reasoning → finish** — by mapping
> theokit `AgentStreamEvent`s onto the Vercel ai-sdk `UIMessageChunk` union so
> `useChat` (`@ai-sdk/react`) materializes a tool-call card and a reasoning block,
> not just text. All chunk shapes are read from ai-sdk **v7.0.14** — the exact
> version theokit pins (`packages/agents/package.json:57` `ai@^7.0.14`;
> `.claude/knowledge-base/references/ai-sdk/packages/ai/package.json:3` `7.0.14`) —
> so there is **zero producer skew**. The blueprint settles four edge cases
> (EC-1 tool lifecycle, EC-2 open/close state machine, EC-3 reasoning grouping,
> EC-4 error branch) against the real chunk producer + the `useChat` chunk
> processor, and records the canonical-protocol ADR: **keep `UIMessageStream`,
> reject an `@ag-ui/*` second wire** with a re-evaluation trigger.
>
> **Verdict: (to be scored by /discover-confidence)**

Scope reminder (from the plan): M1 = tool-call + tool-result + reasoning + finish.
Approval / human-in-the-loop chunks (`tool-approval-request/response`,
`tool-output-denied`) are **M4 (out)**. `source-*` / `file` / `data-*` parts are
YAGNI (not emitted by theokit `AgentStreamEvent`).

---

## Coverage Corner 1 — Integration Tests

*(Q4 — ai-sdk tool/reasoning test pattern; Q5 — the RED cases extending the M0 translator test)*

### Q4 — How ai-sdk tests tool/reasoning chunk emission (the pattern to mirror)

ai-sdk unit-tests the producer mapping with a **fixture-array → `.map(toUIMessageChunk)` → `toEqual`/inline-snapshot** pattern, one `it()` per chunk family:

- **Reasoning** (`.claude/knowledge-base/references/ai-sdk/packages/ai/src/ui-message-stream/to-ui-message-chunk.test.ts:75-127`): a 3-part fixture `[reasoning-start{id}, reasoning-delta{id,text}, reasoning-end{id}]` is mapped and snapshotted; **the same `id` (`'reasoning-1'`) threads all three chunks** — the canonical grouping proof for EC-3.
- **Tool call** (`to-ui-message-chunk.test.ts:399-470`): a `tool-call` part `{toolCallId,toolName,input}` maps to `tool-input-available{toolCallId,toolName,input}` (`:414-423`); an `invalid:true` tool-call maps to `tool-input-error` (`:458-469`).
- **Tool result** (`to-ui-message-chunk.test.ts:472-519`): a `tool-result` part maps to `tool-output-available{toolCallId,output}` (`:489-498`); note the `output: undefined → null` normalization (`:511-517`) so JSON serialization never drops the field (mirrored in the producer at `to-ui-message-chunk.ts:280-282`).

**Assertion oracle:** exact `toEqual` on the chunk object (no extra keys), because the wire schema is a `z.strictObject` union (`ui-message-chunks.ts:26-213`) that rejects extra keys. This is the same oracle the M0 test already uses (`ui-message-stream-translator.test.ts:124-161` validates every emitted chunk against `uiMessageChunkSchema()`), so M1 keeps it.

### Q5 — RED cases extending the M0 translator unit test

The M0 test file (`packages/agents/tests/unit/ui-message-stream-translator.test.ts`) already has the harness M1 reuses verbatim: `fromArray()` (`:28-30`), `yieldThenThrow()` (`:33-36`), `collect()` (`:38-42`), a fixed injected `TEXT_ID` (`:26`), and the schema-conformance loop (`:124-161`). The tool/reasoning fixtures to feed come from `event-translator.test.ts:40-122` (`tool_call{callId,name,input}` at `:44-51`; `tool_result{callId,toolName,output,isError:false}` at `:54-76`; error branch `isError:true` at `:102-122`).

RED cases to add (each asserts an exact ordered chunk array + validates against `uiMessageChunkSchema()`):

| RED test | Input events | Expected chunk sequence |
|---|---|---|
| `test_tool_call_then_result_maps_to_input_available_then_output_available` | `tool_call{callId:'c1',toolName:'read',input:{path:'x'}}`, `tool_result{callId:'c1',toolName:'read',output:'ok',isError:false}`, `done` | `start`, `tool-input-available{toolCallId:'c1',toolName:'read',input:{path:'x'}}`, `tool-output-available{toolCallId:'c1',output:'ok'}`, `finish` |
| `test_tool_result_error_maps_to_output_error` (negative) | `tool_call{callId:'c2',...}`, `tool_result{callId:'c2',toolName:'write',output:'disk full',isError:true}`, `done` | …, `tool-input-available{...c2}`, `tool-output-error{toolCallId:'c2',errorText:'disk full'}`, `finish` (EC-4) |
| `test_orphan_tool_result_synthesizes_input_available` (negative, EC-1 corollary) | `tool_result{callId:'c3',toolName:'glob',output:'ok',isError:false}` with **no** prior `tool_call`, `done` | …, `tool-input-available{toolCallId:'c3',toolName:'glob',input:{}}`, `tool-output-available{toolCallId:'c3',output:'ok'}`, `finish` |
| `test_thinking_run_maps_to_one_reasoning_block` (EC-3) | `thinking{content:'let me '}`, `thinking{content:'think'}`, `done` | `start`, `reasoning-start{id}`, `reasoning-delta{id,delta:'let me '}`, `reasoning-delta{id,delta:'think'}`, `reasoning-end{id}`, `finish` — **one id** |
| `test_reasoning_then_text_closes_reasoning_first` (EC-2) | `thinking{content:'hmm'}`, `text_delta{content:'hi'}`, `done` | `start`, `reasoning-start{id}`, `reasoning-delta{id,'hmm'}`, `reasoning-end{id}`, `text-start{textId}`, `text-delta{textId,'hi'}`, `text-end{textId}`, `finish` |
| `test_text_then_tool_closes_text_first` (EC-2) | `text_delta{content:'ok'}`, `tool_call{callId:'c4',...}`, `done` | `start`, `text-start`, `text-delta`, `text-end`, `tool-input-available{c4}`, `finish` |

Determinism note (mirrors M0 D3): reasoning `id` must be injectable for tests — extend `opts` from `{ textId }` to `{ textId, reasoningId }` (or an injected id-factory), the same pattern the M0 test uses to freeze `textId`. `crypto.randomUUID()` (G8 Web-Standard) is the production default when no id is injected.

---

## Coverage Corner 2 — Dependencies

*(Q6 — does `useChat` alone render a tool-call, or is assistant-ui needed as a test dep; the `ToolCallMessagePart` field list)*

### Is `@ai-sdk/react`'s `useChat` alone sufficient?

**Yes for the M1 unit test; assistant-ui is NOT a test dependency.** The M1 translator is a pure `AgentStreamEvent → UIMessageChunk` mapper (G2 / `sdk-runtime.md` — no runtime). Its acceptance oracle is ai-sdk's own `uiMessageChunkSchema()` (`ui-message-stream-translator.test.ts:136-143`), already an installed dep. `useChat` from `@ai-sdk/react` is what turns those chunks into `message.parts` `ToolUIPart`s via the chunk processor `process-ui-message-stream.ts` (Corner 4) — no third-party renderer is required for the part to materialize.

**assistant-ui is the render acceptance bar (visual/E2E), not a unit dep** — and it carries a **major version skew**: `@assistant-ui/react-ai-sdk` pins `ai ^6.0.209` and `@ai-sdk/react ^3.0.211` (`.claude/knowledge-base/references/assistant-ui/packages/react-ai-sdk/package.json:53-61`), whereas theokit is on `ai ^7.0.14` (`packages/agents/package.json:57`). Adding assistant-ui as an M1 dependency would force an ai@6/ai@7 dual-install. **Recommendation:** M1 tests the chunk contract against ai@7's `uiMessageChunkSchema`; assistant-ui rendering is validated separately (a fixtures/E2E app pinned to assistant-ui's own ai@6), not wired into the `@theokit/agents` unit suite.

### The `ToolCallMessagePart` field list (what a tool-card reads)

assistant-ui's `convertMessage.ts` guards `isToolUIPart(part)` and emits a `ToolCallMessagePart` with these fields (`.claude/knowledge-base/references/assistant-ui/packages/react-ai-sdk/src/ui/utils/convertMessage.ts:219-297`): **`type:'tool-call'`, `toolName`, `toolCallId`, `argsText`, `args`, `result`, `isError`** (`:286-297`). Sourcing: `toolName`/`toolCallId` from the part (`:220-221`); `args` from `part.input` (`:224-235`); `result` from `part.output` when `state==='output-available'` (`:241-244`); `isError=true` + `result={error:part.errorText}` when `state==='output-error'` (`:245-247`). Reasoning parts pass straight through: `part.type==='reasoning' → {type:'reasoning', text:part.text}` (`:212-217`).

The fallback renderer `tool-fallback.tsx` consumes exactly `toolName`, `argsText`, `result`, `status` (`:528-573`): trigger shows `Used tool: <toolName>` (`:169`), args pretty-print `argsText` (`:230-250`), result pretty-prints `result` (`:252-275`). **E2E render assertion target:** a completed tool run shows `Used tool: read`, the args JSON, and the result — proving the `tool-input-available` → `tool-output-available` pair reached the card.

---

## Coverage Corner 3 — Tools

*(Q7 — AG-UI facts + the canonical-protocol decision surface)*

AG-UI (as embodied in CopilotKit) is an **event-based, SSE-transported, cross-vendor** agent protocol — architecturally distinct from ai-sdk's `UIMessageStream` chunk union.

| Dimension | AG-UI (CopilotKit) | UIMessageStream (ai-sdk, M0-adopted) |
|---|---|---|
| Shape | Event objects `BaseEvent` + `EventType` enum | `z.strictObject` chunk union (`ui-message-chunks.ts:26-213`) |
| Event/chunk kinds | `TEXT_MESSAGE_START/END`, `TOOL_CALL_START/END/RESULT`, `RUN_STARTED/FINISHED/ERROR` (`.claude/knowledge-base/references/copilotkit/packages/shared/src/finalize-events.ts:37-144`) | `text-*`, `tool-input-*`, `tool-output-*`, `reasoning-*`, `start`/`finish` |
| Transport | SSE via `EventEncoder` + `rxjs Observable<BaseEvent>` (`.claude/knowledge-base/references/copilotkit/packages/runtime/src/v2/runtime/handlers/shared/sse-response.ts:1-33`) | ai-sdk transport, consumed directly by `useChat` |
| Extra deps | `@ag-ui/client`, `@ag-ui/encoder`, `rxjs` (`sse-response.ts:1-3`) | none beyond `ai` (already pinned) |
| Version maturity | `@ag-ui/client` **0.0.57** — pre-1.0 (`.claude/knowledge-base/references/copilotkit/packages/core/package.json:38`) | `ai` **7.0.14** stable (theokit already pins `packages/agents/package.json:57`) |
| Cross-vendor | Yes — LangGraph adapter `@ag-ui/langgraph 0.0.42` (`.claude/knowledge-base/references/copilotkit/packages/sdk-js/package.json:62`) | ai-sdk-native |
| theokit fit | Needs a NEW encoder + rxjs + a second wire; theokit `AgentStreamEvent` already maps 1:1 to UIMessageChunks | M0 already ships it; `useChat`/assistant-ui consume it natively |

**Decision surface:** AG-UI's only advantage for theokit (cross-vendor client interop) is not a current requirement — the SDK is theokit's single runtime (`sdk-runtime.md`), and its `AgentStreamEvent` union maps directly onto UIMessageChunks (Corner 4). AG-UI would add `rxjs` + `@ag-ui/*` (pre-1.0) + a parallel wire for zero present benefit (YAGNI / G11). See ADR-2.

---

## Coverage Corner 4 — Techniques

*(Q1 tool chunk fields; Q2 reasoning + finish chunk fields; Q3 AgentStreamEvent→chunk mapping; EC-1 tool lifecycle; EC-2 open/close; EC-3 reasoning grouping; EC-4 error branch)*

### Q1 — TOOL chunk fields (from `ui-message-chunks.ts`, the `z.strictObject` union)

| Chunk | Required fields | Optional (M1 omits) | Citation |
|---|---|---|---|
| `tool-input-start` | `toolCallId`, `toolName` | `providerExecuted`, `dynamic`, `title`, `toolMetadata`, `providerMetadata` | `ui-message-chunks.ts:46-55` |
| `tool-input-delta` | `toolCallId`, `inputTextDelta` | — | `ui-message-chunks.ts:56-60` |
| `tool-input-available` | `toolCallId`, `toolName`, `input` | `providerExecuted`, `dynamic`, `title`, `toolMetadata`, `providerMetadata` | `ui-message-chunks.ts:61-71` |
| `tool-output-available` | `toolCallId`, `output` | `providerExecuted`, `dynamic`, `preliminary`, `toolMetadata`, `providerMetadata` | `ui-message-chunks.ts:99-108` |
| `tool-output-error` | `toolCallId`, `errorText` | `providerExecuted`, `dynamic`, `toolMetadata`, `providerMetadata` | `ui-message-chunks.ts:109-117` |

Producer mapping proof: `tool-call → tool-input-available` (`to-ui-message-chunk.ts:233-249`; `invalid:true → tool-input-error` `:212-231`); `tool-result → tool-output-available` with `output undefined→null` (`to-ui-message-chunk.ts:274-295`); `tool-error → tool-output-error` (`to-ui-message-chunk.ts:297-319`).

### Q2 — REASONING chunk fields + the `finish` frame

| Chunk | Required fields | Citation |
|---|---|---|
| `reasoning-start` | `id` | `ui-message-chunks.ts:122-126` |
| `reasoning-delta` | `id`, `delta` | `ui-message-chunks.ts:127-132` |
| `reasoning-end` | `id` | `ui-message-chunks.ts:133-137` |
| `error` | `errorText` | `ui-message-chunks.ts:42-45` |
| `start` | (none; `messageId?` optional) | `ui-message-chunks.ts:186-190` |
| `finish` | (none; `finishReason?` optional) | `ui-message-chunks.ts:191-204` |

`finish.finishReason` enum (optional): `'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'` (`ui-message-chunks.ts:193-202`). Producer maps reasoning-start/end pass-through (`to-ui-message-chunk.ts:91-104`), reasoning-delta with `delta:part.text` (`:106-119`), finish gated by `sendFinish` (`:358-371`). M0 already emits bare `start`/`finish` (no fields) — valid because both are all-optional; M1 keeps that and MAY add `finishReason:'stop'` on `done` / `'error'` on `error`.

### Q3 — `AgentStreamEvent → UIMessageChunk` mapping table (the M1 crux)

theokit event fields from `packages/agents/src/bridge/agent-stream-events.ts`: `ToolCallEvent{callId,toolName,input}` (`:14-20`), `PartialToolCallEvent{callId,toolName,input}` (`:28-33`), `ToolResultEvent{callId,toolName,output,isError,durationMs}` (`:35-43`), `ThinkingEvent{content}` (`:45-49`), `DoneEvent` (`:77-93`), `ErrorEvent{code,message,retryable}` (`:69-75`).

| theokit `AgentStreamEvent` | → chunk(s) | id / correlation source | Notes |
|---|---|---|---|
| `text_delta{content}` | `text-start{id}` (first only) → `text-delta{id,delta:content}` | `opts.textId` (M0) | unchanged from M0 (`ui-message-stream-translator.ts:44-49`) |
| `tool_call{callId,toolName,input}` | `tool-input-available{toolCallId:callId,toolName,input}` | `callId` | **EC-1: NO `tool-input-start` prefix needed** |
| `partial_tool_call{callId,toolName,input}` | *(M1-out)* optionally `tool-input-start` + `tool-input-delta` | `callId` | progressive-args; YAGNI for M1, defer |
| `tool_result{callId,toolName,output,isError:false}` | `tool-output-available{toolCallId:callId,output}` | `callId` | **must follow a `tool-input-available` for callId** (EC-1 corollary) |
| `tool_result{callId,toolName,output,isError:true}` | `tool-output-error{toolCallId:callId,errorText:output}` | `callId` | **EC-4 negative branch** |
| `thinking{content}` | `reasoning-start{id}` (first only) → `reasoning-delta{id,delta:content}` | injected `reasoningId` / `crypto.randomUUID()` | **EC-3: one id for the whole block** |
| `done` | close open text/reasoning, then `finish` (`finishReason:'stop'` optional) | — | terminal |
| `error{code,message,retryable}` | `error{errorText:message}` → close open parts → `finish` | — | M0 pattern (`ui-message-stream-translator.ts:50-54`) |
| `run_started` / `iteration` / `approval_required` / `artifact_*` / `state_update` / `checkpoint_saved` / `file_edit` | **no chunk (M1-out)** | — | ignored, as M0 (`ui-message-stream-translator.ts:56-57`) |

**id sourcing decision:** tools reuse the SDK-supplied `callId` (stable, correlates `tool_call`↔`tool_result` — see `event-translator.test.ts:54-76` proving `call_id` is the correlation key). Reasoning has no SDK id, so the translator mints one per block (injected for tests, `crypto.randomUUID()` in prod — G8).

### EC-1 — Tool lifecycle: is `tool-input-start` required? **NO.**

Proven against the `useChat` chunk processor. `tool-input-available` calls `updateToolPart({state:'input-available', input})` (`process-ui-message-stream.ts:625-648`), and `updateToolPart` **creates the part when none exists** — its `else` branch `state.message.parts.push({type:'tool-<name>', toolCallId, state, input, …})` (`process-ui-message-stream.ts:224-251`). Nothing reads prior state. So a lone `tool-input-available` materializes a `ToolUIPart` in `state:'input-available'` (the render-ready state per the ToolUIPart machine `ui-messages.ts:300-307`). `tool-input-start` is required **only** for progressive streaming: `tool-input-delta` throws `UIMessageStreamError` if no `tool-input-start` seeded `state.partialToolCalls[toolCallId]` (`process-ui-message-stream.ts:583-593`).

**Corollary (hard M1 wiring rule):** `tool-output-available`/`tool-output-error` call `getToolInvocation(toolCallId)`, which **throws** `"No tool invocation found"` when the part does not already exist (`process-ui-message-stream.ts:107-123`, thrown at `:115-122`; called at `:752-753` and `:787-788`). Therefore the translator MUST emit `tool-input-available` for a callId **before** its output chunk. Because theokit's `event-translator` can emit a `tool_result` for a "completed" tool with **no** preceding `tool_call` (`event-translator.test.ts:54-76` — single `tool_result`, no `tool_call`), the M1 translator MUST **synthesize a `tool-input-available{toolCallId,toolName,input:{}}` when it sees an output for an unseen callId** (the `test_orphan_tool_result_synthesizes_input_available` RED case in Corner 1). Track seen callIds in a `Set`.

### EC-2 — Interleave open/close state machine

Two chunk families are streaming **blocks** with start/…/end: **text** and **reasoning**. (Tools in M1 are discrete committed chunks — `tool-input-available` then `tool-output-available` — not a start/end block.) Rule: **at most one streaming block open at a time; opening a block of a different kind, or emitting a tool/finish/error, first closes the currently-open block** with its `-end`:

- open text (`textOpen`) → on a `thinking`, `tool_*`, `done`, or `error` event: emit `text-end{textId}` first.
- open reasoning (`reasoningOpen`) → on a `text_delta`, `tool_*`, `done`, or `error` event: emit `reasoning-end{reasoningId}` first.
- This generalizes M0's single invariant (`text-end` emitted only if `text-start` was — `ui-message-stream-translator.ts:65-67`) to a two-block machine. Dangling opens break the client (`reasoning-end` for a missing part throws — `process-ui-message-stream.ts:479-489`), so closes are mandatory and idempotent (guarded by the `*Open` flags).

### EC-3 — Reasoning grouping: consecutive `thinking` → ONE block

`reasoning-delta` and `reasoning-end` are keyed by `chunk.id` in `state.activeReasoningParts` and **throw** if that id was never opened by a `reasoning-start` (`process-ui-message-stream.ts:461-497`). ai-sdk's own test threads one id (`'reasoning-1'`) through start+delta+end (`to-ui-message-chunk.test.ts:75-127`). So the translator opens **one** `reasoning-start{id}` on the first `thinking`, emits a `reasoning-delta{id,delta:content}` per subsequent `thinking`, and emits a single `reasoning-end{id}` when the block closes (EC-2) — mirroring the M0 text block's `textOpen` latch. N consecutive `thinking` events ⇒ 1 reasoning part, not N.

### EC-4 — Tool error branch: `ToolResultEvent.isError`

`isError:false` → `tool-output-available{toolCallId,output}` (`ui-message-chunks.ts:99-108`); `isError:true` → `tool-output-error{toolCallId,errorText}` (`ui-message-chunks.ts:109-117`). theokit `ToolResultEvent.output` is already a string (`agent-stream-events.ts:40`), so the error branch maps `errorText:output` directly. The consumer surfaces `output-error` as `isError:true` + `result:{error:errorText}` (`convertMessage.ts:245-247`), and `tool-fallback.tsx` shows it (`:277-312`). This is the mandatory negative-case row (`testing.md §4.1`).

---

## ADRs

Both ADRs reference project rules per the plan's Global DoD: `architecture.md` (the
bridge is the only SDK→event adapter), `sdk-runtime.md` (pure mapping — SDK is the only
runtime), `testing.md` (RED before GREEN; edge + negative cases).

### ADR-1 — `AgentStreamEvent → UIMessageChunk` mapping + open/close state machine

**Status:** Proposed (M1). **Context:** M0 shipped text-only; theokit already carries `ToolCallEvent`/`ToolResultEvent`/`ThinkingEvent` (`agent-stream-events.ts:14-49`) but the M0 translator drops them (`ui-message-stream-translator.ts:56-57`), so `useChat` shows nothing when the agent calls a tool or reasons.

**Decision:** Extend `translateToUIMessageStream` (staying a pure mapper per `sdk-runtime.md`/G2, inside the bridge per `architecture.md`) with the Corner-4 mapping table and a two-block open/close state machine (EC-2). Specifically: (a) `tool_call → tool-input-available` with **no** `tool-input-start` prefix (EC-1); (b) `tool_result → tool-output-available | tool-output-error` on `isError`, **synthesizing a `tool-input-available` first for any unseen callId** (EC-1 corollary); (c) consecutive `thinking → ` one reasoning block, one minted id (EC-3); (d) close the open text/reasoning block before switching kinds (EC-2); (e) keep the M0 error/finish contract. Extend `opts` to `{ textId, reasoningId }` for deterministic tests (`testing.md`).

**Rejected alternative:** *Emit the full progressive tool lifecycle* (`tool-input-start` + `tool-input-delta`* + `tool-input-available`) for every tool. Rejected: theokit's committed `ToolCallEvent` already carries the final `input` (`agent-stream-events.ts:14-20`); progressive streaming needs `PartialToolCallEvent` (`:28-33`), which is optional and M1-out (YAGNI/G11). `tool-input-available` alone renders the card (EC-1), so the extra chunks add cost for no M1 benefit. **Re-eval trigger:** wire the progressive path when `PartialToolCallEvent` is emitted end-to-end AND a shipped app needs live-typing tool args.

**Consequences:** one tool card + one reasoning block render in `useChat`; the mapper stays pure and SDK-agnostic; the synthesize-on-orphan rule prevents the `getToolInvocation` throw (`process-ui-message-stream.ts:107-123`).

### ADR-2 — Canonical agent wire: keep `UIMessageStream`, reject an `@ag-ui/*` second wire

**Status:** Proposed (M1) — the protocol ADR the ROADMAP M1 gate names (plan D3). **Context:** two candidate wires — `UIMessageStream` (ai-sdk-native, adopted in M0) and AG-UI (CopilotKit, cross-vendor). Evidence from both refs in Corner 3.

**Decision:** **`UIMessageStream` is theokit's canonical agent wire.** Evidence: (1) theokit already pins the exact producer version — `ai@^7.0.14` (`packages/agents/package.json:57`) = ref `7.0.14` (`.../ai/package.json:3`) — zero skew; (2) theokit `AgentStreamEvent` maps 1:1 onto UIMessageChunks (Corner 4) with no new runtime deps; (3) it is consumed natively by `useChat` (`process-ui-message-stream.ts`) and by assistant-ui's adapter (`convertMessage.ts:219-297`).

**Rejected alternative:** *Adopt AG-UI as a second wire (`@ag-ui/*` adapter).* Rejected: AG-UI requires `@ag-ui/client` + `@ag-ui/encoder` + `rxjs` (`.../copilotkit/.../sse-response.ts:1-3`) and is **pre-1.0** (`@ag-ui/client 0.0.57` — `.../copilotkit/packages/core/package.json:38`). Its sole differentiator, cross-vendor client interop via LangGraph (`@ag-ui/langgraph 0.0.42` — `.../sdk-js/package.json:62`), is not a current theokit requirement (SDK is the single runtime — `sdk-runtime.md`), so a parallel wire is YAGNI (G11). **Re-eval trigger:** revisit when (a) a shipped theokit app must interop with a non-ai-sdk client runtime, AND (b) `@ag-ui/*` reaches ≥ 1.0 stable — then ship an `@ag-ui/*` adapter as an OPT-IN second surface, never replacing `UIMessageStream`.

**Consequences:** M0's `UIMessageStream` choice is confirmed with cited evidence; M1 builds on it; no `rxjs`/`@ag-ui` deps enter the tree; the door stays open (an adapter, not a rewrite) if cross-vendor demand + AG-UI maturity both arrive.

---

## Blocked questions

None. All research questions (Q1–Q7) were answered from real source with resolving
citations; all four edge cases (EC-1..EC-4) were resolved against the ai-sdk chunk
producer + the `useChat` chunk processor. No BLOCKED entries.
