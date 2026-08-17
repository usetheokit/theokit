---
slug: ai-first-canonical-protocol
milestone_id: M1
created_at: 2026-07-04
goal: Extend the theokit UIMessageStream translator to tool-call, tool-result and reasoning chunks so useChat renders a tool-call card
---

# Plan: AI-First Canonical Protocol (M1 — all part types + AG-UI ADR)

> **Version 1.1** (edge-cases EC-1..EC-3 absorbed 2026-07-04) — Extends the M0 text-only `translateToUIMessageStream` to the full `UIMessageStream` part set: map theokit `AgentStreamEvent`s (`tool_call`, `tool_result`, `thinking`, `done`) to the ai-sdk tool/reasoning/finish chunks so `@ai-sdk/react`'s `useChat` renders a **tool-call card** and reasoning — not just text. Records the canonical-protocol ADR (`UIMessageStream` vs AG-UI). Grounded in blueprint `ai-first-canonical-protocol` (SHIPPABLE_WITH_CAVEATS).

## Goal

> Enable a TheoKit agent app to render a tool-call (name + input + result) and reasoning in `@ai-sdk/react`'s `useChat` with no custom adapter, measured by a deterministic integration test asserting the parsed `UIMessage.parts` contain a tool part (`tool-<name>`, state `output-available`) whose input/output equal the agent's emitted tool call/result.

## Context

M1 of `ROADMAP.md` (`theokit-ai-first`), depends on the shipped M0 (`translateToUIMessageStream`, text+error only — `packages/agents/src/bridge/ui-message-stream-translator.ts:33` defers tool/reasoning to M1). theokit `AgentStreamEvent` already carries `ToolCallEvent`/`ToolResultEvent`/`ThinkingEvent` (`agent-stream-events.ts:14-49`), but the M0 translator drops them (`:56`), so `useChat` shows nothing when an agent calls a tool or reasons. This plan widens the pure mapping. Scope: tool-call + tool-result + reasoning + finish. Approval/HITL is M4 (out — YAGNI/G13).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/bridge/ui-message-stream-translator.ts` | 69 | `8c654b4` (2026-07-03) | M0 translator: text-delta→text chunks, error→error chunk, graceful close | M0 text/error behavior byte-unchanged; pure mapping (no LLM); every chunk validates against `uiMessageChunkSchema`; fn ≤ 50 LoC (G6 — extract helpers) |
| `packages/agents/tests/unit/ui-message-stream-translator.test.ts` | 162 | `8c654b4` (2026-07-03) | M0 unit tests (7) | existing cases stay green; new tool/reasoning cases added |
| `packages/agents/src/bridge/agent-stream-events.ts` | 187 | `8842bc6` (2026-07-02) | The `AgentStreamEvent` union (read-only source of the mapping) | read-only — no variant changed |
| `packages/agents/tests/integration/ui-message-stream-e2e.test.ts` | 94 | `f50b1ec` (2026-07-03) | M0 E2E (text round-trips through the ai-sdk consumer) | extended with a tool-call + reasoning case |
| `.claude/knowledge-base/adrs/0036-canonical-protocol-uimessagestream-vs-agui.md` (NEW) | 0 | — | (the canonical-protocol ADR) | — |
| `CHANGELOG.md` | (large) | — | Workspace changelog | new `[Unreleased] § Added` entry |

### Current callers / dependents

- **Symbol:** `translateToUIMessageStream` in `ui-message-stream-translator.ts` — exported via `bridge/index.ts:73` → `@theokit/agents` barrel. Callers: `fixtures/ui-message-stream-skeleton/server/routes/chat.ts` (production), the M0 unit + integration tests. This plan CHANGES its body (widens the mapping); the signature `(events, { textId }) → AsyncGenerator<UIMessageChunk>` is UNCHANGED (additive behavior — old text runs produce identical chunks).
- **Symbol:** `AgentStreamEvent` union — read-only. No change.
- **External:** `@theokit/agents` consumers see richer chunks for tool/reasoning runs; text runs unchanged → backward-compatible.

### Domain glossary

- **tool-input-available** — ai-sdk chunk `{type:'tool-input-available', toolCallId, toolName, input}` that materializes a tool UIPart (`input-available` state). Alone it creates the part (EC-1); `tool-input-start`/`-delta` are only for progressive arg streaming.
- **tool-output-available / -error** — `{toolCallId, output}` / `{toolCallId, errorText}` — transitions the part to `output-available`/`output-error`. **Throws in the consumer if no tool part exists for the callId** (blueprint EC-1) → the translator must synthesize `tool-input-available` for an unseen callId first.
- **reasoning block** — `reasoning-start{id}` → `reasoning-delta{id,delta}` → `reasoning-end{id}`; one id per contiguous run of `thinking` events (EC-3).
- **open block** — at most ONE streaming block (text OR reasoning) is open at a time; opening a different-kind chunk closes the current one first (EC-2, generalizes M0's `textOpen`).

### Architecture boundaries affected

- `rules/architecture.md` + `sdk-runtime.md` + G2 — confined to the `bridge` translator (the only SDK→event adapter); pure mapping over the already-deduped event stream; no LLM call, no runtime. `rules/type-safety.md`/G3 — no `any`, no `as`; the tool `input`/`output` are `unknown` (from `ToolCallEvent.input: unknown`), which is the schema's declared type. G6 — extract helpers so no function exceeds 50 LoC.

## Prior Art & Related Work

- **Internal blueprint** — `.claude/knowledge-base/discoveries/blueprints/ai-first-canonical-protocol-blueprint.md` (Corners 1-4 + 2 ADRs): the chunk shapes, the `AgentStreamEvent→chunk` mapping, the EC-1..EC-4 verdicts, the AG-UI facts.
- **Reference project** — `.claude/knowledge-base/references/ai-sdk/packages/ai/src/ui-message-stream/ui-message-chunks.ts` (tool/reasoning chunk schema), `.../ui/ui-messages.ts:279-499` (ToolUIPart state machine); `.../packages/ai/src/ui/process-ui-message-stream.ts` (the consumer that throws on a missing tool part — EC-1).
- **Reference project (consumer)** — `.claude/knowledge-base/references/assistant-ui/packages/react-ai-sdk/src/ui/utils/convertMessage.ts:212-297` (ToolCallMessagePart field contract) — visual bar, NOT a unit-test dep (pins ai^6).
- **Own-repo** — M0 `ui-message-stream-translator.ts` (base) + `event-translator.test.ts:54-122` (tool fixtures to mirror); `tool-call-input-surfacing` (the dedup lesson).
- **Patterns skills** — none applicable (`theokit-http-decorators-pattern-from-nestjs-patterns` targets HTTP decorators, not the bridge).

## Objective

- [ ] Sub-goal 1 — `tool_call` → `tool-input-available{toolCallId,toolName,input}`; `tool_result{isError:false}` → `tool-output-available{toolCallId,output}`; `isError:true` → `tool-output-error{toolCallId,errorText}` (EC-4), each schema-valid.
- [ ] Sub-goal 2 — a `tool_result` for a callId with no preceding `tool_call` synthesizes `tool-input-available` first, so the consumer never throws (EC-1 corollary).
- [ ] Sub-goal 3 — `thinking` → one `reasoning-start/-delta` block per contiguous run (EC-3); `done`/end closes open blocks then `finish`.
- [ ] Sub-goal 4 — the interleave state machine closes an open text/reasoning block before emitting a chunk of a different kind (EC-2); M0 text/error behavior unchanged.
- [ ] Sub-goal 5 — a deterministic integration test asserts `useChat`-parsed `UIMessage.parts` contain the tool part with the right input/output (the Goal metric).
- [ ] Sub-goal 6 — ADR 0036 records `UIMessageStream` (keep) vs AG-UI (reject) with a re-eval trigger.

## ADRs

### D1 — Extend the M0 translator in place with an explicit open-block state machine + helper extraction

**Decision:** Widen `translateToUIMessageStream` to handle `tool_call`/`tool_result`/`thinking`/`done`, tracking an `openBlock: 'text' | 'reasoning' | null` state and a `seenToolCallIds: Set<string>`. Extract per-kind emit helpers (`emitToolCall`, `emitToolResult`, `emitReasoningDelta`, `closeOpenBlock`) so the generator body stays ≤ 50 LoC (G6).

**Rationale:** `architecture.md` (bridge is the only adapter) + blueprint EC-1/EC-2. The M0 `textOpen` latch generalizes to `openBlock`; a `Set` of seen callIds is the minimal state for the EC-1 synthesis. Extraction satisfies G6 without new abstraction (helpers are module-local pure functions, not interfaces — YAGNI/G11).

**Alternatives considered:** (a) a new `translateToolChunks` separate function composed alongside — REJECTED: two functions over the same stream re-implement ordering + duplicate the open-block state (DRY/G12). (b) emit `tool-input-start`+`-delta`+`-available` for every tool — REJECTED: theokit `ToolCallEvent` carries complete input (not streamed), so `tool-input-available` alone is correct (EC-1) and minimal (KISS).

**Consequences:** one cohesive translator; M1 adds tool/reasoning without touching the SDK path; M4 can add approval chunks by extending the same state machine.

### D2 — Keep `UIMessageStream` as the canonical protocol; reject an AG-UI second wire

**Decision:** theokit's canonical agent wire stays `UIMessageStream` (ai-sdk-native). Do NOT add an `@ag-ui/*` surface.

**Rationale:** M0 already ships `UIMessageStream` with the exact pinned producer (`ai@^7.0.14`, zero skew); AG-UI is protocol-agnostic but pre-1.0 (`@ag-ui/client 0.0.57`) and pulls `@ag-ui/encoder` + `rxjs`. The ROADMAP wedge is "AI-first like ai-sdk" — a second wire is scope the initiative explicitly avoids (G13).

**Alternatives considered:** (a) adopt AG-UI as canonical — REJECTED: pre-1.0, cross-vendor value not needed by any shipped TheoKit app (re-eval trigger below). (b) ship both — REJECTED: two wire formats double the maintenance surface for zero current demand.

**Consequences:** recorded as ADR 0036. Re-eval trigger: a shipped TheoKit app needs non-ai-sdk client interop AND `@ag-ui/*` ≥ 1.0 → then an opt-in adapter, never a replacement.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| The EC-1 consumer-throws-on-missing-tool-part behavior is version-specific to `ai@7`; a future bump could change it | Medium | The integration test drives the REAL `ai@7` consumer, so a regression fails loudly; re-pin is a one-line change | impl |
| Widening the translator risks regressing the M0 text path | Medium | The M0 unit + E2E tests stay in the suite unchanged; they must remain green (regression guard) | impl |
| `tool_result` errorText from `output` (a string) may not be the ideal error message shape | Low | M1 maps `output`→`errorText` for the error branch; richer error mapping is deferred (documented) | impl |

## Unresolved Questions

- Q1 — Does a `thinking` run interleaved between two `text` runs produce `text → reasoning → text` (three blocks) correctly under the open-block state machine? Resolved in T1.2 by a test asserting the interleave closes each block before opening the next (EC-2).

## Dependencies

No new third-party dependency. M1 reuses the M0-pinned `ai@^7.0.14` (devDependency + optional peer on `@theokit/agents` and `theokit`) for the `UIMessageChunk` type + the `uiMessageChunkSchema` test oracle. `assistant-ui` is NOT added — it pins `ai@^6`/`@ai-sdk/react@^3` (a different major) and serves only as the visual render bar; the M1 unit + integration oracle stays `uiMessageChunkSchema()` (ai@7). `/deps-audit` therefore has no new dep to scan (the existing `ai` line was audited in M0).

## Dependency Graph

```
Phase 1 (translator: reasoning+finish → tool chunks) ──▶ Phase 2 (E2E tool-card + ADR) ──▶ Final: Integration Validation
```

Sequential — T1.2 (tool) builds on T1.1's open-block state machine; Phase 2 consumes both.

---

## Phase 1: Extend the translator

**Objective:** The pure translator emits tool + reasoning + finish chunks with a correct open-block state machine, M0 text/error unchanged.

### T1.1 — Open-block state machine + reasoning + finish

#### Objective
Generalize the M0 `textOpen` latch to `openBlock: 'text'|'reasoning'|null`; map `thinking`→one reasoning block (EC-3); `done`/end→close open block then `finish`; close the open block before switching kinds (EC-2).

#### Why this step (action + reasoning)
1. **What this step does** — refactors the generator to track `openBlock`, adds `thinking`→`reasoning-start/-delta` (one id per contiguous run) and `done`→`finish`, and a `closeOpenBlock()` helper that emits `text-end`/`reasoning-end` for the currently-open block.
2. **Why now** — the state machine (EC-2) is the foundation the tool mapping (T1.2) sits on; doing it first keeps T1.2 focused on tool chunks. Cite blueprint EC-2/EC-3 + D1.

#### Evidence
Blueprint Corner 4 (reasoning chunk fields `ui-message-chunks.ts:122-137`; finish `:191-204`; EC-2/EC-3). M0 base `ui-message-stream-translator.ts:41-68` (the `textOpen` latch to generalize).

#### Files to edit
```
packages/agents/src/bridge/ui-message-stream-translator.ts — generalize openBlock; add reasoning + finish + closeOpenBlock helper
packages/agents/tests/unit/ui-message-stream-translator.test.ts — RED: reasoning block, interleave close, done→finish
```

#### Deep file dependency analysis
- `ui-message-stream-translator.ts` (Baseline, 69 LoC) — the generator body generalizes; extract `closeOpenBlock` + reasoning-id minting. Consumers (fixture, tests) unaffected (signature unchanged).

#### Deep Dives
- State: `openBlock: 'text'|'reasoning'|null`, `textId` (from opts), `reasoningId: string|null` (minted via `crypto.randomUUID()` on first `thinking`, cleared on close — G8).
- Invariant (EC-2): before emitting a chunk of a different kind, call `closeOpenBlock()` (emits the open block's `-end`, sets `openBlock=null`).
- Invariant (EC-3): consecutive `thinking` → one `reasoning-start` (first) then `reasoning-delta`s under the same `reasoningId`.
- Edge: `done` closes any open block then `finish`; empty run → `[start, finish]` (M0 unchanged).

#### Pseudo-code / Signatures
```pseudocode
openBlock = null; reasoningId = null
for ev of events:
  if ev.type=='text_delta': if openBlock!='text' { closeOpenBlock(); yield text-start{textId}; openBlock='text' }; yield text-delta{textId, ev.content}
  elif ev.type=='thinking': if openBlock!='reasoning' { closeOpenBlock(); reasoningId=crypto.randomUUID(); yield reasoning-start{reasoningId}; openBlock='reasoning' }; yield reasoning-delta{reasoningId, ev.content}
  elif ev.type=='done': break
  elif ev.type=='error': closeOpenBlock(); yield error{ev.message}; break
closeOpenBlock(); yield finish
# closeOpenBlock(): if openBlock=='text' yield text-end{textId}; if 'reasoning' yield reasoning-end{reasoningId}; openBlock=null
```

#### Tasks
1. RED tests: reasoning block (1 block for N thinking), text↔reasoning interleave closes each block, done→finish, schema-conformance on all new chunks.
2. GREEN: generalize `openBlock`, add reasoning+finish, extract `closeOpenBlock`.
3. Confirm M0 text/error tests still green.

#### TDD
```
RED:     reasoning_run_emits_one_block() — N thinking → [start, reasoning-start, reasoning-delta*, reasoning-end, finish].
RED:     text_then_reasoning_closes_text_first() — text-delta then thinking → text-end precedes reasoning-start (EC-2).
RED:     done_closes_open_block_then_finish() — thinking then done → reasoning-end, finish.
RED:     new_chunks_validate_against_schema() — uiMessageChunkSchema().validate each.
GREEN:   Implement openBlock state machine + reasoning + finish + closeOpenBlock.
REFACTOR: extract closeOpenBlock (keep generator ≤ 50 LoC, G6).
VERIFY:  pnpm --filter @theokit/agents test -- ui-message-stream-translator
```

#### Concurrency tests (only when applicable)

`(none — single-threaded)` — single sequential async consumer, no shared mutable state across concurrent tasks (no lock/atomic/channel).

#### Acceptance Criteria
- [ ] Reasoning + finish + interleave behavior exact; M0 text/error tests still green.
- [ ] Every new chunk passes `uiMessageChunkSchema().validate`.
- [ ] Pass: complexity ≤ 10; generator ≤ 50 LoC (helpers extracted); no `any`/`as`; file ≤ 500.

#### DoD
- [ ] `pnpm --filter @theokit/agents test` green; typecheck clean.

### T1.2 — Tool chunks (call + result + EC-1 synthesis + EC-4 error branch)

#### Objective
Map `tool_call`→`tool-input-available`; `tool_result{isError:false}`→`tool-output-available`, `{isError:true}`→`tool-output-error`; synthesize `tool-input-available` for a `tool_result` whose `callId` was never seen (EC-1), so the consumer never throws.

#### Why this step (action + reasoning)
1. **What this step does** — adds `tool_call`/`tool_result` handling to the T1.1 state machine: emit tool chunks (closing any open text/reasoning block first per EC-2), track `seenToolCallIds`, and synthesize a `tool-input-available` before a `tool-output-*` for an unseen callId.
2. **Why now** — this is the Goal (a tool-call card). It builds on T1.1's `closeOpenBlock`. Cite blueprint EC-1 (consumer throws on missing part — `process-ui-message-stream.ts:107-123`) + EC-4.

#### Evidence
Blueprint Corner 4: tool chunk fields (`ui-message-chunks.ts:46-117`), the `tool-output-*` throws-without-part behavior (EC-1), the `isError` branch (EC-4). theokit `ToolCallEvent{callId,toolName,input}` / `ToolResultEvent{callId,toolName,output,isError}` (`agent-stream-events.ts:14-49`).

#### Files to edit
```
packages/agents/src/bridge/ui-message-stream-translator.ts — add tool_call/tool_result handling + seenToolCallIds + emitToolCall/emitToolResult helpers
packages/agents/tests/unit/ui-message-stream-translator.test.ts — RED: tool call+result, isError branch, orphan tool_result synthesis, interleave with text
```

#### Deep file dependency analysis
- `ui-message-stream-translator.ts` — extend the event switch with tool cases + `seenToolCallIds: Set<string>`; helpers `emitToolCall`/`emitToolResult` keep the body ≤ 50 LoC.

#### Deep Dives
- `tool_call` → `closeOpenBlock()`, then `yield {type:'tool-input-available', toolCallId: ev.callId, toolName: ev.toolName, input: ev.input}`, add `ev.callId` to `seenToolCallIds`. **(EC-1)** theokit tools are runtime-discovered → this must materialize a `dynamic-tool` UIPart; during GREEN, read `to-ui-message-chunk.ts`/`process-ui-message-stream.ts` to confirm whether the chunk needs `dynamic: true` for the consumer to produce a `dynamic-tool` (vs static `tool-<name>`) part, and add the flag if required.
- `tool_result` → `closeOpenBlock()`; if `ev.callId` not in `seenToolCallIds`, first synthesize `{type:'tool-input-available', toolCallId, toolName, input: {}}` (EC-1); then `isError ? {type:'tool-output-error', toolCallId, errorText: String(ev.output)} : {type:'tool-output-available', toolCallId, output: ev.output}`.
- Invariant: tool chunks are NOT a "block" (no open/close) — they are complete parts; but they still close a preceding open text/reasoning block (EC-2).
- Edge/negative: orphan `tool_result` (no prior `tool_call`) → synthesized input part (no throw); `isError:true` → error output.

#### Pseudo-code / Signatures
```pseudocode
elif ev.type=='tool_call': closeOpenBlock(); seen.add(ev.callId); yield tool-input-available{toolCallId:ev.callId, toolName:ev.toolName, input:ev.input}
elif ev.type=='tool_result':
  closeOpenBlock()
  if not seen.has(ev.callId): yield tool-input-available{toolCallId:ev.callId, toolName:ev.toolName, input:{}}; seen.add(ev.callId)
  if ev.isError: yield tool-output-error{toolCallId:ev.callId, errorText:String(ev.output)}
  else: yield tool-output-available{toolCallId:ev.callId, output:ev.output}
# Example: [tool_call{c1,search,{q:'x'}}, tool_result{c1,search,'hit',isError:false}, done]
# → [start, tool-input-available{c1,search,{q:'x'}}, tool-output-available{c1,'hit'}, finish]
```

#### Tasks
1. RED tests: tool_call+tool_result happy → input-available + output-available; isError → output-error; orphan tool_result → synthesized input part; tool after open text → text-end first (EC-2); schema-conformance.
2. GREEN: add tool cases + `seenToolCallIds` + helpers.

#### TDD
```
RED:     tool_call_then_result_maps_to_input_and_output_available()
RED:     tool_result_error_maps_to_output_error() — isError:true → tool-output-error (EC-4, negative case).
RED:     orphan_tool_result_synthesizes_input_available_first() — no prior tool_call → no consumer throw (EC-1).
RED:     tool_after_open_text_closes_text_first() — EC-2.
RED:     tool_chunks_validate_against_schema()
GREEN:   Implement tool cases + seenToolCallIds + emitToolCall/emitToolResult.
REFACTOR: keep generator ≤ 50 LoC (helpers), None else.
VERIFY:  pnpm --filter @theokit/agents test -- ui-message-stream-translator
```

#### Concurrency tests (only when applicable)

`(none — single-threaded)` — single sequential async consumer; `seenToolCallIds` is local to one generator invocation (no shared mutable state across tasks).

#### Acceptance Criteria
- [ ] Tool call/result/error mapping exact; orphan result synthesizes input (EC-1); interleave closes blocks (EC-2).
- [ ] Every tool chunk passes `uiMessageChunkSchema().validate`.
- [ ] Pass: complexity ≤ 10; generator ≤ 50 LoC; no `any`/`as`; file ≤ 500.

#### DoD
- [ ] `pnpm --filter @theokit/agents test` green (all unit, incl. M0 regression); typecheck clean.

---

## Phase 2: E2E tool-call card + protocol ADR

**Objective:** Prove a tool-call round-trips through the REAL ai-sdk consumer into a rendered tool part; record the protocol ADR.

### T2.1 — Deterministic E2E: tool part via the ai-sdk consumer

#### Objective
Extend the M0 E2E: drive a fixed `[tool_call, tool_result, thinking, done]` AgentStreamEvent stream through translator + `uiMessageStreamResponse`, parse via the real ai-sdk consumer (`readUIMessageStream`), and assert the `UIMessage.parts` contain the tool part (state `output-available`, matching input/output) + a reasoning part.

#### Why this step (action + reasoning)
1. **What this step does** — adds an integration test that composes T1.1+T1.2 and asserts the Goal metric (tool part rendered) through the ai@7 consumer — no live LLM, no custom adapter, no assistant-ui.
2. **Why now** — it is the Goal's oracle. Cite blueprint Corner 2 (deps: `useChat`/`readUIMessageStream` alone renders the tool part; assistant-ui is the visual bar only) + D3-M0 (deterministic gate).

#### Evidence
Blueprint Corner 1/2: the ai-sdk consumer (`parseJsonEventStream`+`readUIMessageStream`) materializes `UIMessage.parts` incl. the tool UIPart; `convertMessage.ts:219-297` is the visual field contract. M0 E2E `ui-message-stream-e2e.test.ts` (the base to extend).

#### Files to edit
```
packages/agents/tests/integration/ui-message-stream-e2e.test.ts — add a tool-call + reasoning round-trip case
```

#### Deep file dependency analysis
- Integration test — reuses the M0 chain helper; asserts the tool part's `toolName`/`input`/`output`/`state` from the parsed message.

#### Deep Dives
- Invariant (deterministic): mocked `run.stream()` (fixed events); injected `textId`; the reasoning `id` is minted internally — assert the reasoning part's text, not its id (non-deterministic id, EC-avoidance).
- Assert (EC-1): locate the tool part by `toolCallId` (STABLE), NOT by `type` — theokit runtime tools parse as `dynamic-tool` (not `tool-<name>`). Assert `state:'output-available'`, `input`, `output`, and `toolName` equal the fixture.

#### Pseudo-code / Signatures
```pseudocode
test "useChat parses a theokit tool-call into a rendered tool part":
  events = [tool_call{c1,'search',{q:'ai'}}, tool_result{c1,'search','result-text',isError:false}, thinking('hmm'), done]
  res = uiMessageStreamResponse(translateToUIMessageStream(events, {textId:'t0'}))
  msg = await readLastUIMessage(res.body)         # real ai-sdk consumer
  toolPart = msg.parts.find(p => p.toolCallId === 'c1')
  assert toolPart.state === 'output-available'
  assert toolPart.input == {q:'ai'} and toolPart.output == 'result-text'
  assert msg.parts.some(p => p.type==='reasoning' and p.text==='hmm')
```

#### Tasks
1. RED integration test: tool-call + reasoning round-trip; assert tool part input/output/state + reasoning text.
2. GREEN: confirm T1.1+T1.2 satisfy it (no new production code beyond Phase 1).

#### TDD
```
RED:     usechat_renders_theokit_tool_call_part() — tool part with input/output/state via readUIMessageStream.
RED:     usechat_renders_theokit_reasoning_part() — reasoning part text present.
GREEN:   Compose Phase 1; no new production code.
REFACTOR: None expected.
VERIFY:  pnpm --filter @theokit/agents test -- ui-message-stream-e2e
```

#### Concurrency tests (only when applicable)

`(none — single-threaded)` — the stream is consumed once, sequentially.

#### Acceptance Criteria
- [ ] Integration test green with a mocked provider (deterministic).
- [ ] Tool part asserted with correct input/output/state through the REAL ai-sdk consumer (no custom adapter, no assistant-ui dep).
- [ ] Pass: lint clean; file ≤ 500.

#### DoD
- [ ] `pnpm --filter @theokit/agents test` green (unit + integration).

### T2.2 — ADR 0036: canonical protocol (UIMessageStream vs AG-UI)

#### Objective
Record the D2 decision as a first-class ADR.

#### Why this step (action + reasoning)
1. **What this step does** — writes `.claude/knowledge-base/adrs/0036-canonical-protocol-uimessagestream-vs-agui.md` recording: keep `UIMessageStream`, reject AG-UI, with the cited facts + rejected alternative + re-eval trigger.
2. **Why now** — the ROADMAP M1 gate names this ADR explicitly; it must exist for the milestone to close. Cite blueprint ADR-2 + D2.

#### Evidence
Blueprint ADR-2 (AG-UI facts: `@ag-ui/client 0.0.57`, SSE/event-based, cross-vendor; `ai@^7.0.14` zero skew). ROADMAP M1 gate.

#### Files to edit
```
.claude/knowledge-base/adrs/0036-canonical-protocol-uimessagestream-vs-agui.md — NEW
```

#### Deep file dependency analysis
- New ADR file; no code impact. Follows the existing ADR format (see `0035-*.md`).

#### Deep Dives
- Content: Decision, Rationale (cited facts), Alternatives (adopt AG-UI; ship both — both rejected with reason), Consequences, Re-eval trigger.

#### Tasks
1. Write the ADR following the existing 003x format.

#### TDD
```
RED:     N/A — documentation artifact (no test). Acceptance is structural (sections present).
GREEN:   Write ADR 0036.
REFACTOR: None.
VERIFY:  test -f .claude/knowledge-base/adrs/0036-canonical-protocol-uimessagestream-vs-agui.md
```

#### Concurrency tests (only when applicable)

`(none — single-threaded)` — a documentation file, no code.

#### Acceptance Criteria
- [ ] ADR 0036 exists with Decision + Rationale + ≥1 rejected Alternative + Consequences + Re-eval trigger.

#### DoD
- [ ] File present; CHANGELOG references the ADR.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Tool call/result chunks (Sub-goal 1) | T1.2 | tool-input-available + tool-output-available/error |
| 2 | Orphan tool_result synthesis (Sub-goal 2 / EC-1) | T1.2 | synthesize input part before output |
| 3 | Reasoning + finish (Sub-goal 3 / EC-3) | T1.1 | one reasoning block; done→finish |
| 4 | Interleave state machine (Sub-goal 4 / EC-2) | T1.1, T1.2 | closeOpenBlock before kind switch |
| 5 | E2E tool part rendered (Sub-goal 5) | T2.1 | readUIMessageStream asserts tool part |
| 6 | Protocol ADR (Sub-goal 6 / D2) | T2.2 | ADR 0036 |
| 7 | isError branch (EC-4) | T1.2 | tool-output-error negative case |

**Coverage: 7/7 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/agents test` green (unit + integration, incl. M0 regression)
- [ ] Zero type errors — `pnpm --filter @theokit/agents typecheck`
- [ ] Zero lint warnings on changed files
- [ ] File-size budget respected (translator ≤ 500 LoC; generator fn ≤ 50 via helpers — G6)
- [ ] CHANGELOG.md updated under `[Unreleased] § Added`
- [ ] Backward compatibility preserved — M0 text/error chunks byte-unchanged; translator signature unchanged; barrel exports unchanged
- [ ] Plan-specific: the integration test asserts the parsed tool part input/output/state (the Goal metric)
- [ ] Runtime-metric proof — the integration test observes the full chain producing tool + reasoning chunks in the `v1`-framed body
- [ ] ADR 0036 present
- [ ] Plan archived after `/review` READY_TO_MERGE + merge

## Failure scenarios (when I/O external)

The translator consumes `@theokit/sdk` `run.stream()` (the one external dependency), mocked in tests.

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `@theokit/sdk` `run.stream()` | stream throws mid tool/reasoning | mocked iterable yields a `tool_call` then throws | translator closes any open block + emits `error` chunk + `finish` gracefully; no unhandled throw; SSE terminates with `[DONE]` (M0 behavior, extended to open tool/reasoning state) |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the full chain (mocked provider) with tool + reasoning.

### Execution
```
pnpm --filter @theokit/agents test        # unit + integration (incl. M0 regression)
pnpm --filter @theokit/agents typecheck   # zero type errors
pnpm lint                                  # zero warnings on changed files
```

### Acceptance Criteria
- [ ] All suites green (unit + integration, M0 tests still pass)
- [ ] Coverage ≥ 90% on changed files (translator critical path: 100%)
- [ ] Zero type errors; zero lint warnings
- [ ] Runtime-metric proof — the integration test observes tool + reasoning chunks end-to-end
- [ ] Failure scenario green — the mid-stream throw closes open blocks + terminates

### If Validation Fails
1. Separate plan-caused from pre-existing.
2. Fix all plan-caused failures.
3. Re-run.
4. Log pre-existing in the PR description.
