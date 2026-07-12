# ADR 0048 — M39: thread signals (follow-up queue/wake + subscribe-by-thread) over the M37 durable transport

**Status:** Accepted (2026-07-12) — SCOPE GATE for M39 (accepted BEFORE any code, per the milestone DoD).
**Context slice:** ROADMAP M39; the transport-legitimate slice of the Mastra **Signals** comparison (owner-approved).

## Context

The framework ships M37 (durable/reconnectable SSE by `runId` — `run-event-cache.ts`, `durable-ui-message-stream-response.ts`, `handle-agent-run-reconnect.ts`) and M38 (HITL continuation on one connection). Mastra **Signals** let a client interact with a *thread*: send a follow-up (inject into the running loop / wake idle / queue next turn) and subscribe to a thread for the active-or-next run's stream.

Discovery findings that bound the design:

1. **The SDK loop takes NO mid-run input.** It does not poll for new input during a run. So Mastra's "sendMessage-into-the-running-loop" is not buildable without SDK loop surgery (out of framework scope). M39 QUEUEs a follow-up and dispatches it as a **continuation** after the active run terminates.
2. **There is no `sessionId → runId` mapping today.** `mount-agent.ts` mints a `runId` (`mintRunId`) per run and extracts a `sessionId` from the request (`parseAgentRequestBody`: `b.id` / `b.sessionId`) which it passes to the SDK as the conversation key. Nothing maps a thread (sessionId) to its active run.
3. **The terminal hook is the durable encoder's `finally`** (`durable-ui-message-stream-response.ts` — `cache.end(runId)`), which sees only `runId` + `cache`, not the sessionId.

## Decision

**D1 — The thread IS the existing `sessionId`.** No new identity. `sessionId` already keys the SDK conversation (same sessionId ⇒ the SDK continues the conversation via `ConversationStorageAdapter`), so it IS the thread. The new routes key on it in the URL path. (Parsimony rung 1 — do not invent a `conversationId` field.)

**D2 — A new in-memory `thread-run-registry` singleton** (parallel to `approval-registry` + `run-event-cache`): `sessionId → { activeRunId | null, queue: FollowUp[], waiters }`. Single-process by design; **cross-instance pub/sub + leasing is OUT** (infra/TheoCloud, its own ADR). Enforces **exactly-one-active-run per thread**; follow-ups on an active thread are FIFO-queued.

**D3 — Two NEW opt-in routes; the plain `POST /api/agents/<name>` path stays byte-identical.**
- `POST /api/agents/<name>/threads/<sessionId>/message` — if a run is ACTIVE for `sessionId` ⇒ QUEUE the follow-up (return `202` + the sessionId); if IDLE ⇒ start a run immediately (return `202` + the new `runId`). The run is driven headless into the cache (D4); the client observes it via the thread stream (D3 GET) — the Mastra "subscribe-then-send" shape.
- `GET /api/agents/<name>/threads/<sessionId>/stream` — resolve the thread's active `runId` ⇒ attach to its durable stream (reusing the M37 `cache.attach` + `Last-Event-ID` replay). If no active run ⇒ register a bounded **waiter** that attaches to the next run started on that sessionId (enables subscribe-then-post); a timeout closes an idle wait.

**D4 — Headless continuation pump (no HTTP-reader dependency).** A queued follow-up (and an idle-start) runs via a `pump` that iterates the SDK chunk generator and `cache.append`s directly — NOT via the `Response` `ReadableStream` (whose backpressure would stall a run with no HTTP reader). On terminal the pump calls `threadRegistry.endRun(sessionId, runId)` → dequeues + dispatches the next FIFO follow-up (a new run on the SAME sessionId ⇒ the SDK continues the conversation). Subscribers read from the cache via the thread/reconnect stream.

**D5 — This drives the SDK, it is not a new loop.** M39 reuses `streamAgentUIMessages` / `streamAgentTurnInProcess` (the existing in-process caller) + the M37 cache + the SDK's `send`/continuation + `ConversationStorageAdapter`. It adds **no agent loop, no worker pool, no concurrency/backpressure engine, no dispatcher-orchestration** — the registry is a thin per-thread queue + one-active-run gate over the existing durable transport. Affirms ADR-0040/0044 (transport of app logic = framework home; the loop = `@theokit/sdk`).

**D6 — Reaffirmed OUT (each needs its own demand-gated ADR):** mid-run input injection (SDK loop takes none — M39 QUEUEs); `sendSignal` system-context injection; state-signal lanes (`sendStateSignal`/`computeStateSignal`); the notification inbox + delivery policy (`sendNotificationSignal`/`createNotificationInboxTool`); distributed pub/sub + leasing (`RedisStreamsPubSub`). These are the signal-provider-framework / product / infra halves.

## Consequences

- Thin surface: one new registry module + one headless pump + two routes wired into `serve-aux-routes.ts`; no change to the plain POST path or the SDK loop.
- Single-process boundary documented honestly (as Mastra documents its in-memory pub/sub limit): a follow-up must land on the instance running the thread's active run; cross-instance is a future infra ADR.
- The "subscribe-then-send" pattern works: subscribe to a thread (waiter), POST a message (starts/queues), observe on the subscription.

## Alternatives rejected

- **Mid-run message injection (Mastra `sendMessage`-into-running-loop).** Rejected — the SDK loop takes no mid-run input; injecting would require SDK loop surgery (out of framework scope). M39 QUEUEs as a continuation (named honestly).
- **A new `conversationId` request field.** Rejected — `sessionId` already keys the SDK conversation; a second identity is redundant (YAGNI).
- **Changing the plain POST to enforce one-active-run / register in the registry.** Rejected — breaks back-compat (a second plain POST currently starts a parallel run). The thread endpoints are the opt-in surface.
- **Dispatch queued follow-ups via `durableUiMessageStreamResponse` (the Response stream).** Rejected — with no HTTP reader, its backpressure stalls the headless run. A direct `pump` into the cache avoids the stall.
- **Cross-instance pub/sub + leasing now.** Rejected — infra/TheoCloud, out of scope; M39 is single-process with the boundary documented.
