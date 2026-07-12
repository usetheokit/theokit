# ADR 0050 — M41: Unified typed agent client on the AI SDK `ChatTransport` seam

**Status:** Accepted (2026-07-12) — design GATE for M41 (per the ROADMAP DoD: the ADR is accepted BEFORE code).
**Context slice:** ROADMAP M41; the theokit↔sdk integration DX track (M41 foundation; M42 Tauri, M43 context, M44 client-SDK).

## Context

The agent DEFINITION is already unified across surfaces (`agents/<name>.ts` → `compileAgentModule` →
`streamAgentUIMessages`, identical on web / TUI / Tauri). The CLIENT is fragmented:

1. **Web** — `useAgent(path)` (`packages/theo/src/client/use-agent.ts`): a bespoke React hook that
   fetch-POSTs and consumes SSE via `consumeUIMessageStream`. It has NO reconnect and NO `approve`.
2. **In-process (TUI/Tauri)** — the raw generator `streamAgentTurnInProcess(): AsyncGenerator<UIMessageChunk>`
   (`packages/theo/src/server/agent/stream-agent-turn-in-process.ts`). There is **NO hook at all**; each
   consumer iterates the generator by hand.

Discovery facts (M41 discover, 3 Explore sweeps + `ai@7.0.14` d.ts read):

- The web SSE frames and the in-process generator emit the **SAME** `UIMessageChunk` type (both call
  `streamAgentUIMessages`). Only the transport encoding (SSE vs async iteration) and HITL resolution
  (out-of-band HTTP `POST /approve/<id>` vs inline `awaitApproval` callback) differ.
- `ai@7.0.14` (an **optional peer dependency already declared** by `packages/theo`) exports
  `ChatTransport<UI_MESSAGE>` (`dist/index.d.ts:5350`) with `sendMessages(... {trigger, chatId,
  messageId, messages, abortSignal} & {headers?, body?, metadata?}) => Promise<ReadableStream<UIMessageChunk>>`
  and `reconnectToStream({chatId} & ...) => Promise<ReadableStream<UIMessageChunk> | null>`. It also ships
  `DirectChatTransport` (in-process, binds to `ai`'s OWN `Agent`, reconnect → `null`) and
  `DefaultChatTransport`/`HttpChatTransport` (HTTP, parses the `x-vercel-ai-ui-message-stream: v1` SSE we emit).
- OpenCode (`knowledge-base/references/opencode`) validates the target: ONE transport-agnostic client injected
  per surface with `baseUrl`/`fetch`/`headers`; reconnect via SSE + sequence replay (`?after`/`Last-Event-ID`)
  — the exact shape of our M37 durable transport.

## Decision

### D1 — Adopt `ai`'s `ChatTransport<UIMessage>` as the seam (do NOT invent a parallel interface)

The transport seam IS `ai`'s `ChatTransport<UIMessage>`. `HttpTransport` and `InProcessTransport`
`implements ChatTransport<UIMessage>`.

- **Rejected — hand-roll a `TheoAgentTransport`:** reinvents a SOTA interface already in a shipped
  dependency (parsimony rung 4 / G11). The whole DX win is *reuse the abstraction we already ship*.
- **Rejected — install `@ai-sdk/react` + `useChat({transport})`:** adds a dependency, swaps our thin
  `useAgent` return shape for `useChat`'s heavier surface, and breaks every existing call site.
- **Chosen:** implement `ai`'s `ChatTransport`; keep our own `useAgent` (it internally drives a transport);
  reuse `ai.readUIMessageStream` / `ai.parseJsonEventStream` (the primitives `consumeUIMessageStream`
  already uses) for accumulation. Reuse, no new dependency, back-compat preserved.

### D2 — `AgentTransport = ChatTransport<UIMessage>` + optional `approve` (out-of-band HITL)

`export type AgentTransport = ChatTransport<UIMessage> & { approve?(approvalId, decision): Promise<void> }`.

`ai`'s `ChatTransport` has no `approve` because `ai`'s HITL is IN-BAND (a `tool-approval-request` chunk
answered by re-sending a message part). TheoKit's HITL is OUT-OF-BAND (the server pauses the run; the
client settles via a separate `POST /approve/<id>` or by resolving an inline callback). `approve` is the
one method that route differs per transport, so it belongs on the transport. It is OPTIONAL (agents
without gated tools have no approvals). Re-architecting to `ai`'s in-band HITL is deferred (it would
touch the runtime — G2 — and is out of M41 scope).

### D3 — `HttpTransport` implements `ChatTransport` directly, reusing `ai.parseJsonEventStream`

`HttpTransport` owns its `fetch`, captures the server-minted `x-theokit-run-id` from the `sendMessages`
response, and returns `ReadableStream<UIMessageChunk>` via `ai.parseJsonEventStream`. `reconnectToStream`
GETs `${api}/runs/${capturedRunId}/stream` with `Last-Event-ID`; 404 → `null`. `approve` POSTs `${api}/approve/${id}`.

- **Rejected — subclass `DefaultChatTransport`:** it keys reconnect on `chatId` and does not expose the
  response headers needed to capture our server-minted `runId` (the reconnect key). Fighting the base class
  costs more than ~40 lines of direct code, and the SSE parsing is already reused via `parseJsonEventStream`.
- **Chosen:** direct implementation → byte-identical wire to today's `useAgent` (same POST, headers, SSE).

### D4 — `InProcessTransport` implements `ChatTransport`; `reconnectToStream` → `null`; owns the HITL pending-map

`InProcessTransport` wraps `streamAgentTurnInProcess`. `sendMessages` bridges its
`AsyncGenerator<UIMessageChunk>` → `ReadableStream<UIMessageChunk>` (honoring `abortSignal`).
`reconnectToStream` returns `null` (single process — no dropped server stream; mirrors `DirectChatTransport`).
It owns an internal `awaitApproval` correlated by `approvalId`; `approve(id, decision)` resolves the pending
inline request; an unknown id rejects (fail-fast, Rule 8).

### D5 — Runtime / compile / agent-definition UNTOUCHED; no new dependency

M41 touches ONLY `packages/theo/src/client/` (+ the client barrel and the codegen `.d.ts` string). No
`server/agent/*` behavior change, no `@theokit/sdk` change, no dependency added (`ai` is already an
optional peer). Enforces G2 / `sdk-runtime.md` carve-out (client/boundary, not runtime).

### D6 — `useAgent(pathOrTransport)`; framework-agnostic `AgentClient` store; codegen transport overload

`useAgent` accepts `string | AgentTransport`. A `string` is wrapped in `new HttpTransport({api, headers, fetch})`
(exact back-compat). An `AgentTransport` is used directly (TUI passes an `InProcessTransport`). The hook's
logic lives in a framework-agnostic `AgentClient` store (holds `messages/status/error`; methods
`send/abort/reset/approve/reconnect`; notifies subscribers) so it is unit-tested WITHOUT a DOM; `useAgent`
is a thin binding over it via React's native `useSyncExternalStore` (rung 3 — no test-DOM dependency added).
The return type gains `approve` + `reconnect` (ADDITIVE — `reset` kept). The `@theo/agents` codegen keeps
the `useAgent<K>(name)` typed overload and adds a passthrough overload for `useAgent(transport)`.

## Consequences

- Consolidates two client shapes into ONE hook over one seam (`ChatTransport`). The TUI gains the same
  `useAgent` the web has; no third bespoke consumption shape.
- Adds NO dependency and NO runtime code — reuses `ai` (already a peer) + React's `useSyncExternalStore`.
- Back-compat: existing `useAgent('/path')` call sites keep working (string wraps HttpTransport); the SSE
  wire + M37 reconnect + the agent runtime are unchanged; the return shape is additive.
- The seam is the foundation for M42 (Tauri `ChannelTransport` — another `ChatTransport` impl), M43
  (context/auth via `ChatRequestOptions.headers/body/metadata`), and M44 (standalone client-SDK over the
  same store, no React).

## Reconciliation with prior milestones

- **M35 (in-process seam):** `InProcessTransport` WRAPS `streamAgentTurnInProcess` — it does not replace or
  re-implement it. The generator remains the seam; the transport is a thin `ChatTransport` adapter over it.
- **M37 (durable reconnect):** `HttpTransport.reconnectToStream` calls the existing `GET /runs/<runId>/stream`
  with `Last-Event-ID`. No change to `RunEventCache`, `durableUiMessageStreamResponse`, or the reconnect handler.

## Alternatives rejected (summary)

- Parallel hand-rolled transport interface (D1) — reinvention.
- `@ai-sdk/react` `useChat` (D1) — new dep + breaks back-compat.
- Subclass `DefaultChatTransport` (D3) — chatId/runId impedance.
- No in-process transport, keep raw generator (D4) — leaves the TUI un-unified (defeats the milestone).
- Re-architect HITL to `ai`'s in-band model (D2) — touches runtime, out of scope.
