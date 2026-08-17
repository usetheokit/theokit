# ADR-0047 — M38 `untilIdle`: TheoKit's HITL continuation is already the transport-legitimate slice; ship EVIDENCE, not a no-op flag

**Status:** Accepted (2026-07-11) — the GATE for M38 (roadmap M38 DoD #1). Written AFTER the discover phase, which refuted the milestone's implicit premise.
**Extends:** ADR-0040 (runtime-vs-home), ADR-0044 (multi-surface transports are framework-core), ADR-0046 (M37 durable transport; D6 named `untilIdle` a follow-up).

## Context

M38 was opened as the "transport-legitimate half" of the Mastra **Background Tasks** comparison: an opt-in `untilIdle` that keeps the M37 durable SSE stream open across a `suspend → resume` continuation (a HITL approval today), so the follow-up turn flows on the same connection. Mastra's `untilIdle` exists because a Mastra background task **ENDS the turn** (the LLM emits a final response while the task runs), and the agent must be **RE-INVOKED** when the task completes.

The discover phase (file:line evidence below) established that **TheoKit's HITL does NOT end the turn** — so the premise Mastra's `untilIdle` solves does not exist here:

- `packages/agents/src/bridge/hitl-plugin.ts:86-112` — the `pre_tool_call` hook does `await wiring.awaitApproval(...)`: a genuine **blocking await** inside the SDK run. The run PAUSES in-place mid-iteration; the async generator is suspended, **not** completed.
- `packages/agents/src/bridge/agent-endpoint.ts:90-94` — an `EventQueue` merges the SDK stream with the plugin's `approval_required` event; "when a gated tool pauses the SDK run … the approval event is already queued, so the client sees the approval request while paused." The event becomes a `UIMessageChunk` on the SAME stream.
- `packages/theo/src/server/agent/durable-ui-message-stream-response.ts:54-68` (M37) — the `for await (const chunk of chunks)` in the durable encoder simply **waits** while the run is paused; every chunk (including `approval_required`) is `cache.append`-ed under the `runId`. **No `[DONE]` is emitted during the pause** — the HTTP stream stays open.
- `packages/theo/src/server/agent/approve-agent.ts` + `approval-registry.ts:125-129` — a SEPARATE short `POST /approve` settles the awaited Promise; the SAME suspended run continues, and its post-resume frames flow onto the SAME `runId` stream.
- The approval-registry already carries a per-approval `timeoutMs` + `onTimeout` that settles a hung approval deterministically — a hung pause never leaks the stream.

Verified E2E (pause → approve → tool → done) in `packages/agents/tests/integration/hitl-harness.test.ts`. The one thing NOT covered anywhere: the **combination** HITL-pause **+** M37 client-disconnect/reconnect **+** resume-continuation on one `runId`.

## Decision

**D1 — Do NOT build an `untilIdle` option or `maxIdleMs` timeout.** For the only in-scope trigger (HITL), TheoKit's blocked-await continuation ALREADY keeps the M37 durable stream open across suspend→resume, on one connection, reconnectably — *more robustly* than Mastra's end-turn-then-re-invoke model. An `untilIdle` flag would be a **no-op for HITL** (the stream already stays open) and **dead code** for the out-of-scope background-task trigger (which does not exist). Shipping it violates G11 (YAGNI), G7 (dead export), and the milestone's own quality bar ("no workaround; 100% functional with evidence" — a wait-for-nothing flag cannot be shown functional). `maxIdleMs` is subsumed by the existing approval-registry timeout.

**D2 — Ship the missing EVIDENCE instead: an integration test proving the untested combination.** M38's concrete, 100%-functional-with-evidence deliverable is an integration test that drives, end-to-end on one `runId`: a HITL-gated run streams over the M37 durable encoder → pauses (the `approval_required` frame is cached) → a client disconnects → reconnects via `GET /api/agents/<name>/runs/<runId>/stream` and replays the missed frame(s) via `Last-Event-ID` → a separate `POST /approve` resolves the approval → the continuation frames stream AND cache under the SAME `runId` → a reconnect after resume replays them. This hardens the M37+HITL seam with proof.

**D3 — The background-task re-invoke `untilIdle` stays gated on the dispatch-engine ADR (out-of-scope).** The genuine `untilIdle` use case (re-open/re-enter after a turn ENDS) only arises with a background-task DISPATCH engine that ends the turn while work runs — the second orchestration loop reaffirmed OUT of scope (ROADMAP § Explicitly out of scope, 2026-07-11). If that engine is ever built (its own demand-gated strategic ADR), `untilIdle` becomes its transport companion — NOT before. Building `untilIdle` now would be building the transport for a trigger that will never fire.

## Consequences

- M38 completes honestly: every DoD item gets an evidence-based disposition (below), and the one concrete deliverable (the integration test) is 100% functional with proof — no no-op code enters the tree.
- The M37+HITL continuation-on-one-connection is now PROVEN (not just assembled from separately-tested pieces).
- The runtime/home line holds: no new loop, no dispatcher, no dead flag. The `untilIdle`-as-re-invoke feature is correctly deferred to the (out-of-scope) dispatch engine, documented so a future maintainer does not build the transport ahead of its trigger.

## DoD disposition (roadmap M38)

| DoD item | Disposition |
|---|---|
| Scope ADR GATE | **This ADR.** |
| `stream(input, { untilIdle })` keeps stream open across resume | **Already satisfied by design** (blocked-await + M37) — no flag built (D1). |
| v1 trigger = HITL suspend→resume | **Already works** (`hitl-plugin` blocked await + M37 durable stream); now PROVEN by the integration test (D2). |
| `maxIdleMs` timeout | **Subsumed** by the approval-registry per-approval timeout — not re-built (D1). |
| Aggregate-props caveat | **N/A** — no multi-turn `fullStream` re-aggregation is introduced (the run is one continuous turn, not re-invoked). |
| TDD continuation test | **DELIVERED** — the integration test (D2). |
| background-task-completion trigger | **Deferred** to the dispatch-engine ADR (D3, out-of-scope). |
| Gates green + CHANGELOG + arch/ecosystem docs | Delivered with the test. |

## Alternatives rejected

- **Build the `untilIdle` flag + `maxIdleMs` anyway (to "complete" the milestone literally).** Rejected: a no-op for HITL and dead code for the absent trigger — the exact workaround/theater the milestone's quality bar forbids (G11/G7). Honesty (Rule 3) over box-ticking.
- **Build a background-task dispatch engine so `untilIdle` has a trigger.** Rejected: the milestone's risk #2 explicitly forbids this ("DEFER rather than build the dispatcher to justify it — that would violate G13"). It is the out-of-scope orchestration engine.
- **Do nothing (the behavior already works).** Rejected: the pause+disconnect+reconnect+resume COMBINATION is untested — the honest deliverable is the evidence that closes that gap.
