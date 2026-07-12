---
slug: unified-agent-client-transport
milestone_id: M41
created_at: 2026-07-12
goal: Consolidate the framework's fragmented agent-client surfaces (web `useAgent` fetch+SSE, in-process raw `streamAgentTurnInProcess` generator) behind ONE seam by adopting `ai`'s `ChatTransport`, so a single typed `useAgent` drives both web and TUI with reconnect + approve modeled in the transport.
---

# M41 — Unified typed agent client on the AI SDK `ChatTransport` seam

## Goal

Write the agent once, consume it identically on web and terminal. Today the agent
DEFINITION is unified (`agents/<name>.ts` → `compileAgentModule` → `streamAgentUIMessages`,
identical on every surface), but the CLIENT is fragmented: `useAgent(path)` (web, bespoke
fetch+SSE, no reconnect, no approve) and the raw `streamAgentTurnInProcess(): AsyncGenerator<UIMessageChunk>`
generator (in-process, NO hook at all). This milestone adopts `ai`'s `ChatTransport<UIMessage>`
(already a peer dependency — v7.0.14) as the seam: ship `HttpTransport` (web) + `InProcessTransport`
(TUI) that IMPLEMENT `ChatTransport`, and rebuild `useAgent` as a thin typed wrapper that drives
EITHER transport with the same return shape — adding `approve` and `reconnect` modeled in the
transport. Runtime, agent definition, and compile are UNTOUCHED (client/boundary only — G2/ADR-0040).

## Coverage Matrix

Every Goal/DoD claim maps to ≥ 1 task.

| # | Goal/DoD claim | Task(s) |
|---|---|---|
| C1 | Design ADR accepted BEFORE code (GATE): adopt `ChatTransport`, `useAgent` thin wrapper, runtime untouched, reconcile M35/M37 | T0 |
| C2 | `AgentTransport` seam = `ai`'s `ChatTransport<UIMessage>` + optional `approve` (out-of-band HITL) | T1 |
| C3 | `HttpTransport implements ChatTransport` over the web path (POST mount SSE + `x-theokit-run-id` + M37 reconnect); byte-identical wire | T2, T3 |
| C4 | `InProcessTransport implements ChatTransport` over `streamAgentTurnInProcess`; `reconnectToStream` → `null`; HITL via inline callback | T4 |
| C5 | `useAgent(pathOrTransport)` returns `{ messages, status, error, send, abort, reset, approve, reconnect, __toolNames? }`; drives BOTH transports from the SAME hook | T5 |
| C6 | `approve(id, decision)` routes to the transport HITL path (HTTP `POST /approve/<id>` for web; inline callback resolve for in-process) | T2, T4, T5 |
| C7 | Back-compat: existing `useAgent('/path')` web call sites keep working; SSE wire + M37 reconnect unchanged; agent def/compile/runtime untouched | T5, T6 |
| C8 | Typed-input inference preserved: `@theo/agents` codegen still types `useAgent<K>(name)`; add overload for `useAgent(transport)` | T5, T7 |
| C9 | TDD: HttpTransport.sendMessages yields SSE chunks + reconnect replays; InProcessTransport.sendMessages yields generator chunks; useAgent drives both; typed inference holds | T2, T3, T4, T5, T7 |
| C10 | Docs ("one client, every surface" guide) + CHANGELOG + ADR | T0, T8 |

## Baseline Context

Current state (deep review — a junior implementer should not need to spelunk).

| File | Role | Key facts | LoC |
|---|---|---|---|
| `packages/theo/src/client/use-agent.ts` | Web hook (to rebuild) | `useAgent<TInput>(path, options)` → `{messages,status,error,send,abort,reset,__toolNames?}`. `send` fetch-POSTs `JSON.stringify(input)` with headers `content-type:application/json`, `accept:text/event-stream`, `X-Theo-Action:1`, `...options.headers`; consumes via `consumeUIMessageStream`. No reconnect, no approve. | 117 |
| `packages/theo/src/client/consume-ui-message-stream.ts` | Wire reader (to refactor) | `consumeUIMessageStream(response, onMessage)`: `response.body` → `ai.parseJsonEventStream({stream, schema: uiMessageChunkSchema})` → `ReadableStream<UIMessageChunk>` → `ai.readUIMessageStream({stream})` → `UIMessage`. `ai` dynamically imported (optional peer). The middle `Response → ReadableStream<UIMessageChunk>` piece is exactly what a transport `sendMessages` returns. | 40 |
| `packages/theo/src/client/index.ts` | Client barrel | Exports `consumeUIMessageStream`, `useAgent`, types `UseAgentReturn/UseAgentOptions/UseAgentStatus`. | ~25 |
| `packages/theo/src/server/agent/mount-agent.ts` | Web SSE producer | `mountAgent(mod, request, apiKey, source, csrfMode): Promise<Response>`. `POST /api/agents/<name>`. Body accepts `{messages: UIMessage[], id?}` OR `{message, sessionId?}` (400 if neither yields text). Response = `durableUiMessageStreamResponse`. | — |
| `packages/theo/src/server/agent/durable-ui-message-stream-response.ts` | SSE framing (M37) | Response headers: `content-type: text/event-stream`, `x-vercel-ai-ui-message-stream: v1`, `x-theokit-run-id: run-<uuid>`. Frames `id: <seq>\ndata: <JSON UIMessageChunk>\n\n`; terminal `data: [DONE]`. Chunks from `streamAgentUIMessages(compiled, apiKey, {message, sessionId, hitl, signal})`. | — |
| `packages/theo/src/server/agent/handle-agent-run-reconnect.ts` | Reconnect (M37) | `GET /api/agents/<name>/runs/<runId>/stream`. `Last-Event-ID` header → `afterSeq` (absent → -1). `cache.attach(runId, afterSeq, onFrame, onEnd)` atomic. Unknown run → 404 `{error:{code:'RUN_NOT_FOUND'}}`. Same SSE headers. No CSRF (GET, unguessable runId). | — |
| `packages/theo/src/server/agent/approve-agent.ts` | HITL settle (web) | `POST /api/agents/<name>/approve/<approvalId>`. Body `{approved: boolean, reason?, payload?}` (payload ≤ 16 KiB). 200 `{resolved:true}`; 400 missing `approved`; 403 CSRF; 404 `{error:{code:'NOT_PENDING'}}`. CSRF strict (X-Theo-Action + Origin). | — |
| `packages/theo/src/server/agent/stream-agent-turn-in-process.ts` | In-process seam | `streamAgentTurnInProcess(mod, apiKey, input, deps): AsyncGenerator<UIMessageChunk>`. `input: {message, sessionId?, awaitApproval?, source?, signal?}`. Gated tools w/o `awaitApproval` → sync `InProcessApprovalRequiredError` (fail-fast). `awaitApproval(req:{approvalId,toolName,opts}) => Promise<boolean|HitlDecision>`. Same `streamAgentUIMessages` source as web. | ~130 |
| `packages/theo/src/vite-plugin/agents-typed-client.ts` | Typed codegen | Generates `.theokit/agents.d.ts` → `declare module '@theo/agents'` with `useAgent<K extends keyof AppAgents>(name: K): UseAgentReturn<AppAgents[K]['input'], AppAgents[K]['tools']>`; runtime `export { useAgent } from 'theokit/client'`. Input inferred via `InferAgentInput`, tools via `InferAgentToolNames`. | ~196 |

Git sha at plan time: `70b4fd6` (M41 roadmap amendment). Branch `develop`.

Architecture boundary: this is ALL under `packages/theo/src/client/` (+ one server barrel note for `streamAgentTurnInProcess` which is already exported). Dependency direction unchanged (`client → core` only). No runtime/LLM/provider/storage code touched (G2 / `sdk-runtime.md` carve-out — client/boundary).

Glossary: **UIMessageChunk** = `ai`'s streamed frame (text-delta, tool-input-available, …). **UIMessage** = reconstructed message (accumulation of chunks). **ChatTransport** = `ai`'s transport interface (`sendMessages` + `reconnectToStream`). **runId** = server-minted per-run id (returned in `x-theokit-run-id`), the reconnect key (NOT `chatId`).

## Prior Art

- **`ai@7.0.14` `ChatTransport<UI_MESSAGE>`** (`node_modules/ai/dist/index.d.ts:5350-5413`): `sendMessages(options: {trigger, chatId, messageId, messages, abortSignal} & ChatRequestOptions) => Promise<ReadableStream<UIMessageChunk>>` and `reconnectToStream(options: {chatId} & ChatRequestOptions) => Promise<ReadableStream<UIMessageChunk> | null>`. `ChatRequestOptions = {headers?, body?, metadata?}` (`:5426-5436`) — the per-request context channel.
- **`ai` `DirectChatTransport`** (`:5801-5814`): in-process transport that binds to `ai`'s OWN `Agent` class (NOT our `@theokit/sdk`), `reconnectToStream` always returns `null`. NOT reusable directly (coupled to `ai`'s Agent), but is the exact TEMPLATE for `InProcessTransport`'s contract (return a chunk stream; reconnect → null).
- **`ai` `DefaultChatTransport`/`HttpChatTransport`** (`:5751-5768`): HTTP transport that parses the `x-vercel-ai-ui-message-stream: v1` SSE we already emit. NOT reused because it keys reconnect on `chatId`, while our reconnect keys on the server-minted `runId` captured from the `x-theokit-run-id` response header — an impedance the base class does not expose. We reuse the lower-level `ai.parseJsonEventStream` parser instead (same primitive `consumeUIMessageStream` already uses).
- **OpenCode** (`knowledge-base/references/opencode`): ONE transport-agnostic client (`packages/sdk/js/src/v2/client.ts:50-93`) injected with `baseUrl`/`fetch`/`headers`; every surface (TUI `packages/tui/src/context/sdk.tsx`, web `packages/app/src/utils/server.ts`) shares it, differing only in what it injects. Reconnect via SSE + event-sequence replay (`packages/protocol/src/groups/session.ts:327-342` `?after={seq}`, `serverSentEvents.gen.ts:110-171` `Last-Event-ID`) — this VALIDATES our M37 design. **Emulate:** one client, per-surface injection. **Do NOT copy:** per-surface UI-framework bindings (Solid.js/Effect) — those stay in the consumer.

## ADRs

### ADR D1 — Adopt `ai`'s `ChatTransport` as the seam (do NOT invent a parallel interface)

**Decision:** the transport seam IS `ai`'s `ChatTransport<UIMessage>`. Our `HttpTransport` and
`InProcessTransport` `implements ChatTransport<UIMessage>`.

**Alternatives considered:** (a) Hand-roll a `TheoAgentTransport` interface — REJECTED: reinvents a
SOTA interface already in a shipped dependency (parsimony rung 4 violation; G11). (b) Install
`@ai-sdk/react` + use `useChat({transport})` — REJECTED: adds a dependency, replaces our thin
`useAgent` return shape with `useChat`'s heavier surface, and breaks back-compat for every existing
call site. **Chosen:** implement `ai`'s `ChatTransport`, keep our own `useAgent` (which internally
drives a transport), reuse `ai.readUIMessageStream`/`parseJsonEventStream` for accumulation. Reuse,
no new dep, back-compat preserved.

### ADR D2 — `AgentTransport = ChatTransport<UIMessage>` + optional `approve` (out-of-band HITL)

**Decision:** define `AgentTransport extends ChatTransport<UIMessage>` adding one OPTIONAL method
`approve(approvalId: string, decision: ApprovalDecision): Promise<void>`.

**Rationale + alternatives:** `ai`'s `ChatTransport` has NO approve method because `ai`'s HITL model
is in-band (a `tool-approval-request` chunk answered by RE-SENDING a message with the approval part).
TheoKit's model is OUT-OF-BAND: the server PAUSES the run (`registry.register` blocks) and the client
settles it via a SEPARATE `POST /approve/<id>` (web) or by resolving an inline callback (in-process).
(a) Re-architect TheoKit HITL to `ai`'s in-band model — REJECTED for M41: large, touches the runtime
(G2), out of scope. (b) Expose approve as a free function, not on the transport — REJECTED: the HITL
route differs per transport (HTTP endpoint vs inline callback), so it belongs ON the transport.
`approve` is optional (not every agent has gated tools). **Chosen:** minimal one-method extension of
the adopted interface; the seam stays `ChatTransport`.

### ADR D3 — `HttpTransport` implements `ChatTransport` directly, reusing `ai.parseJsonEventStream`

**Decision:** `HttpTransport` owns its `fetch`, captures `x-theokit-run-id` from the sendMessages
response, and returns `ReadableStream<UIMessageChunk>` via `ai.parseJsonEventStream`. `reconnectToStream`
GETs `${api}/runs/${capturedRunId}/stream` with `Last-Event-ID`; 404 → `null`. `approve` POSTs
`${api}/approve/${id}`.

**Alternatives:** subclass `DefaultChatTransport` — REJECTED: it keys reconnect on `chatId` and does
not expose the response headers needed to capture our server-minted `runId` (D2 of the reconnect wire).
Fighting the base class costs more than the ~40 lines of direct implementation, and the SSE parsing is
already reused via `parseJsonEventStream` (the same primitive the base class uses internally). **Chosen:**
direct implementation; byte-identical wire to today's `useAgent` (same POST, same headers, same SSE).

### ADR D4 — `InProcessTransport` implements `ChatTransport`; `reconnectToStream` → `null`; owns HITL pending-map

**Decision:** `InProcessTransport` wraps `streamAgentTurnInProcess`. `sendMessages` bridges the
`AsyncGenerator<UIMessageChunk>` into a `ReadableStream<UIMessageChunk>` (respecting `abortSignal`).
`reconnectToStream` returns `null` (single process, no dropped server stream — mirrors `ai`'s
`DirectChatTransport`). It owns an internal `awaitApproval` correlated by `approvalId`; `approve(id,
decision)` resolves the pending inline request. If the agent has gated tools and the consumer never
calls `approve`, the underlying fail-fast (`InProcessApprovalRequiredError`) still applies when
`awaitApproval` is required but the transport was constructed without HITL enabled.

**Alternatives:** no in-process transport (keep raw generator) — REJECTED: leaves the TUI without the
unified hook (the whole milestone). **Chosen:** the thin bridge; `useAgent` now powers the TUI too.

### ADR D5 — Runtime/compile/agent-definition UNTOUCHED; no new dependency

**Decision:** M41 touches ONLY `packages/theo/src/client/` (+ the client barrel and the codegen
`.d.ts` string). No `packages/theo/src/server/agent/*` behavior change, no `@theokit/sdk` change, no
new dependency (`ai` already an optional peer). Enforces G2 / `sdk-runtime.md` carve-out (client/boundary).

### ADR D6 — `useAgent(pathOrTransport)` overload; `@theo/agents` codegen adds a transport overload

**Decision:** `useAgent` accepts `string | AgentTransport`. A `string` is wrapped in `new
HttpTransport({api: path, headers, fetch})` (exact back-compat). An `AgentTransport` is used directly
(TUI passes an `InProcessTransport`). Return type gains `approve` + `reconnect` (ADDITIVE — `reset`
kept). The `@theo/agents` codegen keeps the `useAgent<K>(name)` typed overload and adds a passthrough
overload for `useAgent(transport)`.

## Tasks

### Phase 0 — Design gate

#### T0 — Write ADR-0050 (the design GATE) + docs skeleton

- **Why this step:** the DoD makes the ADR a GATE before code. It locks D1–D6 so implementation
  does not drift, and records the reconciliation with M35 (in-process seam) and M37 (durable reconnect).
- **Deliverable:** `.claude/knowledge-base/adrs/0050-m41-unified-agent-client-chattransport.md` capturing
  D1–D6 with alternatives; a `docs/agents/agent-client.md` skeleton ("one client, every surface").
- **TDD:** N/A (documentation artifact). Acceptance: ADR contains all six decisions each with ≥ 1
  rejected alternative; `python3 -c "import pathlib; assert pathlib.Path('.claude/knowledge-base/adrs/0050-m41-unified-agent-client-chattransport.md').exists()"`.

### Phase 1 — Transport seam + HttpTransport

#### T1 — Define `AgentTransport` + shared client transport types

- **Why this step:** every later task depends on the seam type. Defining it first (D1/D2) lets
  HttpTransport/InProcessTransport/useAgent all reference one contract.
- **Files:** `packages/theo/src/client/transport.ts` (new) — `export type AgentTransport = ChatTransport<UIMessage> & { approve?(approvalId: string, decision: ApprovalDecision): Promise<void> }`; `export interface ApprovalDecision { approved: boolean; reason?: string; payload?: unknown }`.
- **TDD (RED):** `tests/unit/agent-transport-types.test.ts` — `test_agent_transport_is_assignable_to_chat_transport`: `expectTypeOf<HttpTransport>().toMatchTypeOf<ChatTransport<UIMessage>>()` (type test; compiles only when the seam extends `ChatTransport`). Assertion literal: `expectTypeOf`.
- **Parsimony:** rung 4 — `ChatTransport`/`ApprovalDecision`-shape reuse `ai` + existing `approve-agent.ts` body shape.

#### T2 — `HttpTransport implements AgentTransport`

- **Why this step:** the web surface (the majority of existing call sites) must keep working byte-for-byte
  while now being a `ChatTransport`. This is the back-compat anchor (C7).
- **Files:** `packages/theo/src/client/http-transport.ts` (new). Refactor `consume-ui-message-stream.ts`
  to export `responseToChunkStream(response): ReadableStream<UIMessageChunk>` (the middle piece), keeping
  `consumeUIMessageStream` as a thin caller over it (DRY, no behavior change).
  - `sendMessages({messages, abortSignal, headers, body})`: POST `api` with headers `content-type:application/json`,
    `accept:text/event-stream`, `X-Theo-Action:1`, `...this.headers`, `...headers`; body `JSON.stringify({...body, messages})`;
    capture `res.headers.get('x-theokit-run-id')` into `this.lastRunId`; return `responseToChunkStream(res)`.
  - `reconnectToStream({chatId})`: if `!this.lastRunId` → `null`; GET `${api}/runs/${this.lastRunId}/stream`
    (+ `Last-Event-ID` when a last seq is known); 404 → `null`; else `responseToChunkStream(res)`.
  - `approve(id, decision)`: POST `${api}/approve/${id}` with `X-Theo-Action:1` + JSON `decision`; throw on non-2xx.
- **TDD (RED):** `tests/unit/http-transport.test.ts`
  - `test_sendMessages_yields_uimessagechunks_from_sse` (mock fetch returns an SSE body of 2 chunk frames → the returned stream yields 2 `UIMessageChunk`s).
  - `test_sendMessages_captures_run_id_header` (mock response sets `x-theokit-run-id: run-abc`; assert a subsequent `reconnectToStream` GETs `/runs/run-abc/stream`).
  - `test_reconnect_returns_null_when_no_prior_run` and `test_reconnect_returns_null_on_404`.
  - `test_approve_posts_to_approve_endpoint_with_csrf_header`.
- **Failure scenarios** (external I/O — fetch): see `## Failure scenarios`.

#### T3 — Reconnect replay integration for HttpTransport (reuse M37 harness)

- **Why this step:** reconnect is a DoD bullet and the M37 value; a transport that cannot replay a
  dropped stream is not parity. Reuse the existing M37 reconnect test harness rather than a new server.
- **Files:** `tests/integration/http-transport-reconnect.test.ts` (new) — drive `mountAgent` + `handleAgentRunReconnect`
  against `HttpTransport.sendMessages` then `reconnectToStream`, asserting frames after `Last-Event-ID` replay.
- **TDD (RED):** `test_http_transport_reconnect_replays_frames_after_last_event_id` — start a run via the transport,
  capture runId, simulate drop, `reconnectToStream`, assert the post-drop chunks are delivered exactly once.

### Phase 2 — InProcessTransport

#### T4 — `InProcessTransport implements AgentTransport`

- **Why this step:** gives the terminal/in-process surface a `ChatTransport` so the SAME `useAgent`
  drives it (C4/C6). Mirrors `ai`'s `DirectChatTransport` contract.
- **Files:** `packages/theo/src/client/in-process-transport.ts` (new). Constructed with `{mod, apiKey, stream?}`
  (inject `streamAgentTurnInProcess` for tests via `deps`).
  - `sendMessages({messages, abortSignal})`: extract text from the last user `UIMessage`; call
    `streamAgentTurnInProcess(mod, apiKey, {message, signal: abortSignal, awaitApproval: this.#awaitApproval})`;
    bridge the `AsyncGenerator<UIMessageChunk>` → `ReadableStream<UIMessageChunk>`.
  - `reconnectToStream()` → `null` (documented; mirrors `DirectChatTransport`).
  - `#awaitApproval(req)`: register `req.approvalId` in a pending-map returning a Promise; `approve(id, decision)`
    resolves it (`{approved}` → boolean/`HitlDecision`). Unknown id → reject (fail-fast, Rule 8).
- **TDD (RED):** `tests/unit/in-process-transport.test.ts`
  - `test_sendMessages_bridges_generator_to_readable_stream` (mock `deps.stream` yields 2 chunks → stream yields 2).
  - `test_reconnect_returns_null` .
  - `test_approve_resolves_pending_inline_request` (a gated-tool run parks on `awaitApproval`; `approve(id,{approved:true})` unblocks and the run continues).
  - `test_approve_unknown_id_rejects` (negative case — typed error, not silent).
  - `test_abort_signal_stops_the_stream` (edge/negative — aborting mid-stream ends the ReadableStream).

### Phase 3 — Unified `useAgent` + typed codegen + back-compat

#### T5 — Rebuild `useAgent` as a thin wrapper over `AgentTransport`

- **Why this step:** the consolidation itself — ONE hook over the seam, driving web (Http) and TUI
  (InProcess) with the same return shape, adding `approve`/`reconnect` (C5/C6/C7).
- **Files:** `packages/theo/src/client/use-agent.ts` (rewrite). `useAgent(pathOrTransport: string | AgentTransport, options)`:
  string → `new HttpTransport({api: path, headers: options.headers, fetch: options.fetch})`; else use directly.
  - `send(input)`: build a user `UIMessage` from `input` (text part from `input.message` when present, else
    `JSON.stringify(input)` as text — the server already accepts `{messages}`); `transport.sendMessages({trigger:'submit-message', chatId, messageId:undefined, messages:[...prior, userMsg], abortSignal, body: input})`; accumulate via `ai.readUIMessageStream` (upsert by id, as today).
  - `abort` / `reset` unchanged.
  - `approve(id, decision)`: `await transport.approve?.(id, decision)`.
  - `reconnect()`: `const s = await transport.reconnectToStream({chatId}); if (s) accumulate(s)`.
  - Return `{messages, status, error, send, abort, reset, approve, reconnect, __toolNames?}`.
- **TDD (RED):** `tests/unit/use-agent-unified.test.tsx` (or `.test.ts` with a React test renderer)
  - `test_useAgent_with_path_string_wraps_http_transport_and_streams` (back-compat: string path → messages accumulate).
  - `test_useAgent_with_in_process_transport_streams_same_shape` (TUI: pass `InProcessTransport` → same `{messages,status}` transitions).
  - `test_useAgent_approve_routes_to_transport` (spy transport.approve called with id+decision).
  - `test_useAgent_reconnect_accumulates_replayed_messages`.
  - `test_useAgent_abort_sets_idle_and_stops` (edge/negative).

#### T6 — Back-compat verification (existing web call sites + wire unchanged)

- **Why this step:** C7 is a hard requirement; prove no existing consumer breaks and the SSE wire +
  M37 reconnect are unchanged.
- **Files:** run the existing suites that exercise `useAgent` and the mount/reconnect wire
  (`packages/create-theokit/tests/integration/scaffold-real.test.ts`, `tests/**/mount-agent*`, `tests/**/*reconnect*`).
- **TDD:** no new RED — this is a regression gate: the pre-existing tests MUST stay green with the
  rewritten hook (the return shape is additive; the wire is byte-identical). Acceptance: `pnpm --filter theokit test` green for the touched suites.

#### T7 — Update `@theo/agents` codegen for the transport overload

- **Why this step:** C8 — typed-input inference must survive the rewrite, and the generated hook must
  accept a transport too.
- **Files:** `packages/theo/src/vite-plugin/agents-typed-client.ts` — extend the generated `.d.ts` with a
  second `useAgent` overload `(transport: AgentTransport): UseAgentReturn<...>` alongside the existing
  `(name: K)` overload; update the `import type` to include `AgentTransport` from `theokit/client`.
- **TDD (RED):** `tests/unit/agents-typed-client-transport.test.ts` — the generated `.d.ts` string
  contains BOTH overloads and imports `AgentTransport`; snapshot the generated module for the fixture manifest.

### Phase 4 — Docs

#### T8 — Docs + CHANGELOG

- **Why this step:** C10 — a "one client, every surface" guide + the changelog contract (Rule 6).
- **Files:** finish `docs/agents/agent-client.md` (web via path, TUI via `InProcessTransport`, approve,
  reconnect, the `ChatTransport` seam + why we adopted it); `packages/theo/CHANGELOG.md` `[Unreleased] § Added`
  + `§ Changed` (additive return shape) + a one-line migration note (none needed — additive).
- **TDD:** N/A (docs). Acceptance: the guide shows both surfaces from the same `useAgent`; CHANGELOG entries present.

## Dependencies

Per Unbreakable Rule 9 — no new dependency is introduced.

| Dependency | Version | Status | Rule-9 note |
|---|---|---|---|
| `ai` | `>=7.0.0` (installed `7.0.14`) | **Already an optional peer dep** of `packages/theo`. Reused for `ChatTransport`, `parseJsonEventStream`, `readUIMessageStream`, `uiMessageChunkSchema`, `UIMessage`/`UIMessageChunk` types. | No add; reuse the shipped SOTA interface (rung 4). |
| `react` | existing | Existing peer (the hook). | No change. |

No CVE surface changes (no dependency added or bumped). `/deps-audit` verdict: PASS (no `## Dependencies` delta beyond reuse).

## Failure scenarios

External I/O present (browser `fetch` in `HttpTransport`). Each must fail fast + typed (Rule 8):

| Scenario | Expected behavior | Test |
|---|---|---|
| `sendMessages` POST returns 5xx | The returned stream errors; `useAgent` sets `status:'error'` + `error` (not a silent empty stream). | `test_sendMessages_5xx_surfaces_error` (T2) |
| `sendMessages` POST returns 4xx (e.g. 400 bad body) | Same — error surfaced, not swallowed. | `test_sendMessages_4xx_surfaces_error` (T2) |
| Network drop mid-stream | The stream ends; `reconnectToStream` (with captured runId + `Last-Event-ID`) replays the tail exactly once. | T3 |
| `reconnectToStream` when run already completed / evicted → 404 | Returns `null` (no throw); `useAgent.reconnect()` is a no-op. | `test_reconnect_returns_null_on_404` (T2) |
| `approve` POST returns 404 `NOT_PENDING` | `approve` throws a typed error (the approval id was unknown/settled) — never silent. | `test_approve_404_throws` (T2) |
| `abortSignal` fired mid-stream | Stream stops; `useAgent` returns to a non-streaming state without setting `error` (aborts are not errors — existing behavior). | `test_abort_signal_stops_the_stream` (T4/T5) |
| In-process `approve` unknown id | Rejects (fail-fast) — no silent resolve. | `test_approve_unknown_id_rejects` (T4) |

## Concurrency tests

Signals present: async streams + an in-process pending-approval map (`approve` resolves a Promise created
by `awaitApproval` on another async path). Race-aware coverage:

- `test_approve_resolves_pending_inline_request` (T4) exercises the register-then-resolve handoff across
  two async turns (the run parks on the approval Promise; `approve` on a later turn resolves it). This is
  the one cross-async coordination point; the rest of the transport is single-consumer per stream (no
  shared mutable state across concurrent `sendMessages` calls — each call creates its own stream + run).
- No shared global mutable state is introduced (each transport instance owns its `lastRunId` / pending-map;
  no module-level singletons). Not `(none — single-threaded)`: the approval handoff is the genuine race and it is tested.

## Drawbacks & Risks

1. **Re-fragmenting instead of consolidating.** If `useAgent` gained an in-process path but left a
   separate raw-generator consumption pattern documented as the TUI way, the fork persists. *Mitigation:*
   the ADR (D6) mandates ONE hook; T5's `test_useAgent_with_in_process_transport_streams_same_shape` proves
   the TUI uses the same hook; docs (T8) show only the unified path.
2. **`approve` model mismatch with `ai`'s in-band HITL.** Our out-of-band `approve` is an extension, not
   part of `ai`'s `ChatTransport`. A future migration to `ai`'s in-band model would change this. *Mitigation:*
   `approve` is optional + documented as TheoKit's pause/registry model; D2 records the deferral explicitly.
3. **`send(input)` → `UIMessage` conversion for non-`{message}` inputs.** Arbitrary typed inputs are
   serialized as a text part; richer structured inputs rely on the `body: input` passthrough the server
   already reads. *Mitigation:* the server accepts `{messages}` AND `{...input}`; T5 covers the `{message}`
   common case; the `body` passthrough preserves arbitrary fields. Non-`{message}` shapes are an Unresolved
   Question (below), not a regression (today's hook POSTs `input` directly — same information reaches the server).
4. **React test ergonomics.** Testing a hook needs a renderer. *Mitigation:* use `@testing-library/react`
   if already present, else drive the hook's transport-facing logic through a headless harness (extract the
   accumulation into a testable function). Confirmed in T5.

## Unresolved Questions

- **Q1:** For agents whose `input` is NOT `{message: string}` (richer typed objects), is the canonical wire
  the `body: input` passthrough (server reads `input` fields) OR a structured user `UIMessage`? *Resolution
  path:* keep today's behavior (POST carries `input`) via the transport `body`; revisit if/when an agent
  ships a non-`{message}` input in a template. Does NOT block M41 (back-compat preserved either way).
- **Q2:** Should `reconnect()` be auto-invoked by `useAgent` on stream error, or stay manual? *Resolution:*
  manual for M41 (explicit `reconnect()` in the return); auto-reconnect-on-drop is an M42 concern (parity
  across surfaces). Recorded so M42 picks it up.

## Test Plan

- **Unit:** T1 (type), T2 (HttpTransport sendMessages/reconnect/approve + failure scenarios), T4
  (InProcessTransport bridge/approve/abort), T5 (useAgent over both transports), T7 (codegen overloads).
- **Integration:** T3 (HttpTransport ↔ real `mountAgent` + `handleAgentRunReconnect` replay), T6 (existing
  scaffold + wire suites stay green).
- **Type tests:** T1 `expectTypeOf` seam assignability; T7 generated `.d.ts` overload presence.
- **Gates (post-implementation):** `pnpm --filter theokit typecheck`, `eslint packages/ --max-warnings=0`,
  `pnpm --filter theokit test`, G6 file sizes, knip (no orphan exports — every new export consumed), `/code-quality`.

## Acceptance Criteria / DoD mapping

| DoD bullet | Evidence |
|---|---|
| Design ADR (GATE) | ADR-0050 present with D1–D6 (T0) |
| HttpTransport implements ChatTransport over web path | T2 unit + T3 reconnect integration; byte-identical POST/headers/SSE |
| InProcessTransport implements ChatTransport | T4 unit (bridge, reconnect→null, approve, abort) |
| useAgent returns {messages,status,error,send,abort,reset,approve,reconnect}; web + TUI same hook | T5 (both transports, same shape) |
| approve(id,decision) routes to transport HITL path | T2 (HTTP), T4 (inline), T5 (routes) |
| Back-compat: existing call sites + wire + runtime unchanged | T6 regression green; D5 (no runtime touch) |
| Typed-input inference preserved + transport overload | T7 codegen test |
| TDD across the surface | T2/T3/T4/T5/T7 RED-first |
| Docs + CHANGELOG + ADR | T0 + T8 |
