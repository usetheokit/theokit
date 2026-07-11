# ADR-0046 — M37 resumable/reconnectable agent streams (durable transport over SSE)

**Status:** Accepted (2026-07-11) — the GATE for M37 (no durable-transport code ships before this is signed; roadmap M37 DoD #1).
**Extends:** ADR-0040 (runtime-vs-home), ADR-0044 (multi-surface transports are framework-core), ADR-0045 (M36 push transport — the Tauri `Channel` half; M37 is the symmetric HTTP/SSE half).

## Context

The framework already exposes `agents/*.ts → SSE endpoint` emitting `UIMessageStream` (`mount-agent.ts` → `uiMessageStreamResponse`). But a stream is **request-scoped**: if the client drops (mobile, spotty network, long tool use), the run is lost and frames emitted while disconnected are gone. The Mastra **Durable Agents** comparison (2026-07-11) showed TheoKit has the SDK-side durable primitives (workflow suspend/resume + json persistence — SE29; HITL tool approval — M18-M30) but lacks the **transport half**: reconnect-by-`runId` + event replay. The owner chose (option **a**) to build this in the **framework**, not the SDK.

The runtime/home boundary is load-bearing here: durable *transport* (reconnect, replay, cache) is transport of app logic → framework home (ADR-0040/0044). The agent *loop* + suspend/resume + checkpoints are runtime → `@theokit/sdk`. This ADR draws that line so M37 cannot drift into a parallel orchestration engine.

## Decision

**D1 — Scope: durable TRANSPORT is framework-core; the loop stays SDK; NO broker in core (the GATE).** M37 ships a durable layer over the EXISTING SSE surface — it wraps `streamAgentUIMessages`, never a new loop. What ships in `packages/` core: a `RunEventCache` interface + an in-memory default + a reconnect endpoint. What does NOT enter core: any cross-process PubSub broker, message queue, or Inngest — those stay opt-in adapters (behind the interface) or SDK-side. This honors the ROADMAP out-of-scope "reimplementing the agent loop / own multi-agent orchestration" and ADR-0040's SDK-owns-runtime invariant.

**D2 — A transport `runId` minted at the HTTP boundary, surfaced via the `x-theokit-run-id` response header.** `mountAgent` mints a stable transport `runId` (`run-<uuid>`) and returns it as a response header so the client can reconnect. This is DISTINCT from the SDK-internal `run-${Date.now()}` carried in the `run_started` frame (that is the loop's id, minted deep in `sdk-adapter.ts:515`; the transport must not depend on reaching into the adapter). The transport owns its reconnect key. Rationale: reconnect is a transport concern; minting at the waist keeps the cache key independent of the runtime's internal id.

**D3 — Resume via SSE-native `Last-Event-ID` (reuse, do NOT invent a protocol).** Each SSE frame gains a monotonic `id: <seq>\n` line before its `data:`. On reconnect the browser's `EventSource` (or any SSE client) sends the `Last-Event-ID` header automatically; the reconnect endpoint replays frames with `seq > lastEventId`, then attaches to the live tail. Rationale (parsimony rung 3 — native platform feature): the SSE spec (WHATWG HTML §server-sent-events) already defines `id:`/`Last-Event-ID` for exactly this; a custom cursor/query-param protocol would reinvent it.

**D4 — `RunEventCache` = interface + in-memory default, mirroring the approval-registry pattern.** A per-`runId` buffer of ordered frames plus a set of live listeners. The load-bearing method is atomic: `attach(runId, afterSeq, onFrame, onEnd)` synchronously snapshots frames with `seq > afterSeq` AND registers the live listener in the same tick — so no frame slips between replay and subscribe, and none is duplicated (single-threaded, no `await` between). `append`/`end` drive it; `end` schedules a bounded eviction timer (parity with `getApprovalRegistry()`'s cleanup). Single-process by default (documented, like the approval registry); a persistent backend (Redis / the SDK's `ConversationStorageAdapter` seam) is pluggable via the interface but NOT shipped in core.

**D5 — Reconnect/observe endpoint: `GET /api/agents/<name>/runs/<runId>/stream`.** Added to `serve-aux-routes.ts` following the existing `is<X>Path(urlPath)` → handler convention. Reads `Last-Event-ID`, replays cached frames after it, then — if the run is still live — pipes the live tail; a SECOND client can observe a run a first client started. Run ended → replay + `[DONE]` + close. Unknown `runId` → 404. The request's `AbortSignal` unsubscribes on client disconnect.

**D6 — `untilIdle` DEFERRED (documented, not silently dropped).** Keeping the HTTP connection open across background-task continuations (Mastra's `untilIdle`) is a SEPARATE concern: it needs the background-dispatch orchestration gap (deliberately deferred, SDK-side) resolved first, and it changes the connection lifecycle. M37 ships reconnect/replay only. Rationale: YAGNI — the demand the comparison surfaced is "drop and reconnect without missing chunks"; `untilIdle` is a follow-up milestone once background dispatch lands.

**D7 — In-process path unchanged.** The durable encoder is HTTP-only. The TUI/Tauri in-process path (`streamAgentTurnInProcess`) does not reconnect over HTTP, so it keeps the plain `UIMessageChunk` generator — no cache, no seq ids. The durable layer wraps only the HTTP `uiMessageStreamResponse` waist.

## Alternatives rejected

- **A cross-process PubSub broker (Redis pub/sub) in core** — Mastra's approach. Rejected for core: it IS the orchestration-engine gap the ROADMAP defers. Kept as an opt-in `RunEventCache` backend, never a core dependency.
- **Reusing the SDK-internal `run-${Date.now()}` as the reconnect key** — it is minted deep in `sdk-adapter.ts:515` and only surfaced inside the `run_started` frame; the transport would have to parse the stream to learn its own key. Minting at the waist (D2) is cleaner and keeps the transport independent of the runtime's id scheme.
- **A custom cursor/query-param resume protocol** — reinvents SSE `Last-Event-ID` (D3). Rejected (parsimony).
- **Switching the transport to WebSocket** — the surface is already SSE (`UIMessageStream`, the ai-sdk consumer contract); WebSocket would break `useChat` interop for a reconnect feature SSE already supports natively. Out of scope.
- **Wrapping the in-process path too** — the TUI/Tauri surfaces don't reconnect over HTTP; caching their frames would be dead weight (YAGNI). D7 keeps them plain.

## Consequences

- The web surface gains durable-agent transport parity: a client can drop and reconnect (or a second client observe) without missing chunks — the exact gap the Mastra comparison surfaced.
- Single-process by default (documented); multi-instance deploys plug a persistent `RunEventCache` backend without touching core.
- Core stays transport-of-app-logic: no broker, no queue, no Inngest, no new loop. The runtime/home line (ADR-0040) holds.
- `untilIdle` and a persistent cache backend become named follow-ups, not silent gaps.
