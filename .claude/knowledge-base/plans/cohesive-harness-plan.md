---
slug: cohesive-harness
milestone_id: M4
created_at: 2026-07-04
goal: Wire the shipped-but-dead @HumanInTheLoop + @Checkpoint decorators into the M2 agents/*.ts endpoint as an adapter over the SDK — HITL approval rides the ai-sdk-native UIMessageStream approval chunks (paused via the SDK's async pre_tool_call hook), resume reuses the SDK conversation storage — with no parallel runtime
---

# Plan: Cohesive harness — adapter over the SDK (M4 — Eixo C)

> **Version 1.0** — Make the framework's already-shipped `@HumanInTheLoop` + `@Checkpoint`
> decorators FUNCTIONAL by wiring them into the M2 `agents/*.ts` endpoint (`mountAgent`) as an
> adapter over `@theokit/sdk`. HITL approval emits the ai-sdk-native `tool-approval-request` /
> `tool-approval-response` / `tool-output-denied` `UIMessageStream` chunks (M1 deferred them);
> the pause is the SDK's own async `pre_tool_call` hook (verified `await`-ed). Resume reuses the
> SDK `ConversationStorageAdapter` via `sessionId`. Grounded in blueprint `cohesive-harness` +
> the accepted scope gate ADR 0038.

## Goal

> A TheoKit agent (`agents/<name>.ts` or an `@Agent` class) that declares a HITL-gated tool
> pauses before that tool runs, emits a `tool-approval-request` on its `UIMessageStream`, and
> awaits a human decision delivered via `POST /api/agents/<name>/approve/<approvalId>`; on approve
> the tool runs and the stream continues, on deny/timeout the loop receives a denial result and
> continues coherently. A `@Checkpoint`-declared agent emits `checkpoint_saved`; a follow-up
> request with the same `sessionId` resumes from the SDK-persisted history. All wiring — NO LLM
> call, NO tool dispatch, NO second loop, NO new store. Measured by a deterministic E2E asserting
> pause → approve → tool-runs → done, the deny path, and a resume-from-session assertion.

## Context

M4 of `ROADMAP.md` (`theokit-ai-first`), depends on shipped M1 + M2. The scope GATE (ADR 0038) is
accepted: the harness is an ADAPTER (invariant refined — a parallel runtime stays out of scope,
wiring the SDK + shipped decorators is in scope). `@HumanInTheLoop`/`@Checkpoint` +
`ApprovalRequiredEvent`/`CheckpointSavedEvent` exist today as DEAD metadata (no producer/consumer)
— a G10 honest-enforcement violation this milestone closes. The SDK owns the loop
(`runReflectiveLoop` wraps `run.stream()`), storage (`ConversationStorageAdapter`), and the async
`pre_tool_call` veto seam (`manager.ts:122` `await h(ctx)`).

## Baseline Context (deep review of current state)

| File | Role | M4 touch |
|---|---|---|
| `packages/agents/src/decorators/human-in-the-loop.ts` | `@HumanInTheLoop` metadata (question/timeout/onTimeout) — DEAD | read config to gate a tool |
| `packages/agents/src/decorators/checkpoint.ts` | `@Checkpoint` metadata (strategy/storage) — DEAD | read config to emit checkpoint |
| `packages/agents/src/bridge/agent-stream-events.ts:59,128` | `ApprovalRequiredEvent` / `CheckpointSavedEvent` — DEAD types | PRODUCE them in the harness |
| `packages/agents/src/bridge/ui-message-stream-translator.ts` | M1 translator (text/tool/reasoning) | ADD approval-request/denied chunk mapping (M1 deferred) |
| `packages/agents/src/bridge/agent-endpoint.ts` | M2 `streamAgentUIMessages` (compiled → SDK → translate) | thread the HITL plugin + approval resolver |
| `packages/agents/src/bridge/sdk-adapter.ts:113` | per-run `plugins` seam + `createSdkAgentStream` | inject the HITL `pre_tool_call` plugin |
| `packages/theo/src/server/agent/mount-agent.ts` | M2 endpoint wiring point | session-aware + approval route + pending-approval registry |
| SDK `ConversationStorageAdapter` / `Agent.getOrCreate(sessionId,{storage})` | storage + resume | reuse (no new store) |

- **Git sha at plan time:** `19f6990`.
- **Verified SDK primitives:** `pre_tool_call` hook is `await`-ed (`../theokit-sdk/.../plugins/manager.ts:122`), so a plugin can PAUSE the run by returning a pending Promise; `Agent.resume` + `paused` status exist; `ConversationStorageAdapter` persists by conversationId.
- **Glossary:** *HITL* = human-in-the-loop tool approval; *approval resolver* = the Promise the pre_tool_call plugin awaits, resolved by the approve route; *harness* = the M2 endpoint made stateful (adapter, ADR 0038).

## Prior Art & Related Work

- **ai-sdk v7 native HITL** — `tool-approval-request`/`tool-approval-response`/`tool-output-denied` `UIMessageChunk`s (`node_modules/ai/dist/index.d.ts:2297,2303,2327`), rendered by `useChat`. The wire M4 emits.
- **M1 deferral** — the M1 blueprint deferred these approval chunks to M4.
- **SDK permission plugin** — `createPermissionPlugin`/`pre_tool_call` async veto (the pause seam).
- **The existing loop** — `runReflectiveLoopStream` (wraps `run.stream()`, never reimplements).

## Objective

Wire `@HumanInTheLoop` (approval, paused via the async SDK hook, over the ai-sdk approval chunks)
+ `@Checkpoint` (emit + resume via SDK storage) into the M2 endpoint, with a deterministic E2E and
an invariant guard proving no parallel runtime.

## ADRs

### ADR-M4a — HITL pause = the SDK's async `pre_tool_call` hook (in-run), not a cross-request dance

- **Decision.** The harness injects a `pre_tool_call` plugin. For a HITL-gated tool it emits
  `tool-approval-request` on the stream and returns a Promise the SDK loop awaits; the approve
  route resolves it (allow → `undefined`, deny → `{ block: true, message }`). The SSE stream stays
  open across the human wait (the SDK loop is genuinely paused inside the awaited hook).
- **Alternatives.** (a) Cross-request `Agent.resume` for HITL → more complex, unneeded (the hook
  awaits). (b) Bespoke non-ai-sdk event → violates ADR 0036 (canonical wire). Rejected.
- **Consequence.** HITL is single-connection + emits the ai-sdk-native chunk; `@HumanInTheLoop`
  becomes functional.

### ADR-M4b — Resume reuses the SDK storage by `sessionId` (no new store)

- **Decision.** Resume = a request with the same `sessionId` → `Agent.getOrCreate(sessionId, {
  conversationStorage })` re-hydrates prior turns (SDK-owned). `@Checkpoint` emits `checkpoint_saved`
  at its strategy point (the `resumeToken` = `sessionId`). No `create-conversation-history`
  resurrection (M3 deleted it — ROADMAP risk-2 stale).
- **Consequence.** Resume "just works" over the SDK; the milestone wires the event + proves it.

## Drawbacks & Risks

1. **Holding an SSE connection open during human approval** (ADR-M4a) — a slow approver ties up a
   connection. Mitigated by `@HumanInTheLoop.timeout` + `onTimeout` (abort/proceed/retry) enforced
   as an `AbortSignal` race on the approval resolver; a timeout resolves the Promise deterministically.
2. **Pending-approval registry is in-process state** — a multi-instance deploy needs a shared
   registry. Mitigated: scope M4 to the single-process contract (documented); the registry is an
   injectable interface so a durable impl can slot in later (no new store built now — YAGNI).
3. **HITL on the `defineAgent` (functional) surface vs the `@Agent` (class) decorator.** `@HumanInTheLoop`
   is a method decorator (class path). `defineAgent`'s `tools` are functional. Mitigated: M4 wires
   the CLASS path (where `@HumanInTheLoop` lives) first (the E2E uses an `@Agent` class agent); a
   `defineAgent`-level HITL declaration is a documented follow-up (do not force both now — the
   class path satisfies the DoD with the shipped decorator).
4. **Invariant slippage** (ADR 0038) — mitigated by an explicit guard test (no LLM fetch in the
   harness; the loop is `runReflectiveLoop`, not reimplemented).

## Unresolved Questions

(none — the SDK pause/resume/storage primitives are verified; the approval chunks are confirmed in
the ai `UIMessageChunk` union; the surface + invariant are gated by ADR 0038.)

## Dependencies

| Dependency | Version | Rule 9 (present?) | CVE gate |
|---|---|---|---|
| `@theokit/sdk` (pre_tool_call hook, storage, resume) | peer >=2.9.0 | yes | n/a |
| `ai` (approval chunk types + schema oracle) | ^7 (peer/dev) | yes | n/a |
| (none new) | — | M4 is wiring | — |

No new dependency. The pause seam, storage, and approval chunks all already exist.

## Dependency Graph

```
Phase 1 (approval chunks in the translator + HITL producer plugin)  ─┐
        ↓                                                             │
Phase 2 (mount-agent: session + pending-approval registry + approve  │  (needs the plugin +
         route + resolver wiring)  ←──────────────────────────────────┘   chunk emission)
        ↓
Phase 3 (@Checkpoint → checkpoint_saved + resume-by-sessionId proof)
        ↓
Phase 4 (deterministic E2E: pause→approve→done + deny + resume) + invariant guard
        ↓
Phase 5 (examples/agent-saas minimal harness app for the DoD-3 E2E) + CHANGELOG
```

## Phase 1: Approval chunks in the translator + the HITL producer plugin

#### Objective
Extend the M1 `translateToUIMessageStream` to map `approval_required` (and a denial) onto the
ai-sdk `tool-approval-request` / `tool-output-denied` chunks; add a `pre_tool_call` plugin factory
in `@theokit/agents` that, for a HITL-gated tool, emits an `ApprovalRequiredEvent` + awaits an
injected approval resolver.

#### Why this step (action + reasoning)
The wire (chunks) + the pause producer (plugin) are the core primitives everything else composes.
Doing them first lets Phase 2 wire them into the endpoint.

#### Evidence
- ai approval chunks: `node_modules/ai/dist/index.d.ts:2297,2303,2327`.
- M1 translator: `ui-message-stream-translator.ts:103` (the mapping site).
- Async veto: `../theokit-sdk/.../plugins/manager.ts:122` (`await h(ctx)`).
- `@HumanInTheLoop` config reader: `human-in-the-loop.ts:56` `getHumanInTheLoopConfig`.

#### Files to edit
- `packages/agents/src/bridge/ui-message-stream-translator.ts` (map `approval_required` → `tool-approval-request`; a denied result → `tool-output-denied`)
- `packages/agents/src/bridge/hitl-plugin.ts` (new — `createHitlPlugin({ gatedTools, emit, awaitApproval })`)
- export from `packages/agents/src/bridge/index.ts`

#### Deep file dependency analysis
The plugin imports only SDK plugin types + the `@HumanInTheLoop` config (agents-internal). The
translator gains one branch (no signature change). Both stay in `@theokit/agents` (G1).

#### Deep Dives
The plugin's `pre_tool_call` handler: if `ctx.toolName ∈ gatedTools` → `const approvalId = crypto.randomUUID(); emit({type:'approval_required', callId: approvalId, toolName, question, input}); const ok = await awaitApproval(approvalId, timeout, onTimeout); return ok ? undefined : { block: true, message: 'denied by human' }`. The SDK loop awaits this — genuine pause.

#### Pseudo-code / Signatures
```ts
// hitl-plugin.ts
export interface HitlWiring {
  gated: Map<string, HumanInTheLoopOptions>   // toolName → config
  emit: (e: ApprovalRequiredEvent) => void
  awaitApproval: (approvalId: string, opts: HumanInTheLoopOptions) => Promise<boolean>
}
export function createHitlPlugin(w: HitlWiring): Plugin
```

#### Tasks
- T1.1 Translator: map `approval_required` → `tool-approval-request` chunk; a denied tool result → `tool-output-denied`.
- T1.2 `createHitlPlugin` — the async `pre_tool_call` producer.
- T1.3 Export + barrel.

#### TDD
- T1.1 RED: `test_translator_maps_approval_required_to_tool_approval_request` — feed an
  `ApprovalRequiredEvent`, assert a `tool-approval-request` chunk validating against
  `uiMessageChunkSchema()`. Deny → `tool-output-denied`.
- T1.2 RED: `test_hitl_plugin_emits_and_awaits_then_allows_or_blocks` — a fake `pre_tool_call` ctx
  for a gated tool → asserts `emit` called with `approval_required` + the returned Promise blocks
  until `awaitApproval` resolves (allow → undefined; deny → `{block:true}`). Non-gated tool → passes through untouched.

#### Concurrency tests (only when applicable)
- `test_hitl_plugin_two_concurrent_gated_tools_get_distinct_approvalIds` — two gated calls await
  independently (distinct approvalIds; resolving one does not resolve the other). The pending-approval
  map is the shared state; assert no cross-talk.

#### Failure scenarios (external I/O)
- `test_hitl_plugin_timeout_resolves_per_onTimeout` — `awaitApproval` times out → `onTimeout`
  'abort' rejects/blocks, 'proceed' allows, 'retry' re-emits. Deterministic via an injected clock/signal.

#### Acceptance Criteria
- Translator emits valid `tool-approval-request`/`tool-output-denied` chunks (schema-validated).
- The plugin pauses (awaits) for gated tools, passes non-gated through, honors allow/deny/timeout.

#### DoD
- 4+ RED tests green; translator M1 behavior byte-unchanged for non-approval events; barrel exports; no LLM call in the plugin.

## Phase 2: mount-agent — session + pending-approval registry + approve route

#### Objective
Make the M2 endpoint HITL-capable: a per-session pending-approval registry, inject the HITL plugin
into `streamAgentUIMessages`, and add `POST /api/agents/<name>/approve/<approvalId>` that resolves
the pending approval.

#### Why this step (action + reasoning)
This is the app-level packaging (ADR 0038 D2) — the M2 endpoint made stateful. It's the "harness
surface" (DoD-2) without a new primitive.

#### Evidence
- M2 wiring point: `mount-agent.ts` (`mountAgent` + `streamAgentUIMessages`).
- Plugin seam: `sdk-adapter.ts:113` per-run `plugins`.
- The approve route pattern: mirror the reserved-prefix routing of the M2 agent middleware.

#### Files to edit
- `packages/theo/src/server/agent/approval-registry.ts` (new — an injectable in-process registry: `register(approvalId) → Promise<boolean>`, `resolve(approvalId, approved)`)
- `packages/theo/src/server/agent/mount-agent.ts` (thread the HITL plugin + registry into the stream; detect the approve sub-path)
- `packages/theo/src/vite-plugin/agent-middleware.ts` + `cli/commands/start/handlers.ts` (route `POST /api/agents/<name>/approve/<id>` to the registry — dev + prod parity, reuse the M2 pattern)

#### Deep file dependency analysis
The registry is a small injectable (interface + in-process impl). `mountAgent` builds the HITL
wiring from the compiled agent's `@HumanInTheLoop` config + the registry, passes the plugin to
`streamAgentUIMessages` (needs a Phase-1 param addition). Dev+prod both mount the approve route
(EC parity, like M2).

#### Deep Dives
On stream start, `mountAgent` derives `gated` (tools with `@HumanInTheLoop`) from the compiled
agent; the plugin's `emit` pushes the `ApprovalRequiredEvent` into the same event stream the
translator consumes; `awaitApproval` calls `registry.register(approvalId)`. The approve route calls
`registry.resolve(approvalId, approved)`.

#### Pseudo-code / Signatures
```ts
// approval-registry.ts
export interface ApprovalRegistry {
  register(approvalId: string, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<boolean>
  resolve(approvalId: string, approved: boolean): boolean   // false if unknown/expired
}
export function createInProcessApprovalRegistry(): ApprovalRegistry
```

#### Tasks
- T2.1 `createInProcessApprovalRegistry` (register/resolve + timeout).
- T2.2 `streamAgentUIMessages` accepts an optional HITL wiring; `mountAgent` builds it from the agent config + registry.
- T2.3 Route `POST /api/agents/<name>/approve/<approvalId>` (dev middleware + prod handler) → `registry.resolve`.

#### TDD
- T2.1 RED: `test_registry_register_resolves_on_approve` + `test_registry_times_out` +
  `test_resolve_unknown_id_returns_false`.
- T2.3 RED: `test_approve_route_resolves_pending_and_returns_200` + `test_approve_route_404_on_unknown_agent`
  (via the handlers, mirroring the M2 `agent-handlers.test.ts`).

#### Concurrency tests (only when applicable)
- `test_registry_two_pending_approvals_resolve_independently` (shared-map race guard).

#### Failure scenarios (external I/O)
- `test_approve_route_rejects_missing_or_malformed_body` (approved flag required) → 400 typed error.
- CSRF: the approve route enforces the same `csrfMode` as the agent endpoint (reuse the M2 CSRF gate).

#### Acceptance Criteria
- A HITL agent's stream pauses; the approve route resolves it; timeout honored; dev+prod parity; CSRF enforced.

#### DoD
- Registry + route tests green; `mountAgent` wires HITL without touching the M2 non-HITL path (byte-unchanged for agents with no `@HumanInTheLoop`); CHANGELOG updated.

## Phase 3: @Checkpoint emit + resume-by-sessionId

#### Objective
Emit `checkpoint_saved` at the `@Checkpoint` strategy point and prove resume: a follow-up request
with the same `sessionId` re-hydrates from SDK storage.

#### Why this step (action + reasoning)
DoD-2's "resume" leg. The SDK already persists by conversationId; M4 wires the event + proves the
re-hydration contract (no new store — ADR-M4b).

#### Evidence
- `@Checkpoint` config: `decorators/checkpoint.ts`. Event: `CheckpointSavedEvent`
  (`agent-stream-events.ts:128`). SDK storage/resume: `sdk-adapter.ts:127` `conversationStorage`.

#### Files to edit
- `packages/agents/src/bridge/agent-endpoint.ts` (when the compiled agent has `@Checkpoint`, emit `checkpoint_saved` at the strategy boundary; thread `conversationStorage` through)
- `packages/theo/src/server/agent/mount-agent.ts` (resume: pass the request `sessionId` to the stream so `Agent.getOrCreate(sessionId, {storage})` re-hydrates)

#### Deep file dependency analysis
Resume needs the SAME `conversationStorage` adapter across requests (a `FileSystemConversationStorage`
keyed by sessionId is the durable default; in-memory for tests). `mountAgent` already parses a
`sessionId`; thread it + the storage to `createSdkAgentStream`.

#### Deep Dives
`checkpoint_saved` maps onto the UIMessageStream as a `data-*`/transient part OR is a
side-observable event (per EC-4 the M2 wire is canonical — emit a `data-checkpoint` part or omit
from the wire and expose via a header; decide in TDD). The resume proof: request A runs 1 round +
persists; request B (same sessionId) asserts the SDK loaded A's turns (no re-run).

#### Pseudo-code / Signatures
```ts
// in agent-endpoint.ts streamAgentUIMessages(compiled, apiKey, { message, sessionId, storage?, hitl? })
```

#### Tasks
- T3.1 Emit `checkpoint_saved` when `@Checkpoint` present (mapped to the wire per TDD).
- T3.2 Thread `sessionId` + `conversationStorage` so resume re-hydrates.

#### TDD
- T3.1 RED: `test_checkpoint_saved_emitted_when_checkpoint_declared` (a `@Checkpoint` agent → the
  event/chunk appears; a non-checkpoint agent → none).
- T3.2 RED: `test_resume_by_sessionId_rehydrates_prior_turns` — with an in-memory storage, run
  message A (sessionId s1), then message B (s1) → assert the SDK `getOrCreate` was called with s1 +
  the stored history includes A (no duplicate execution of A's tool).

#### Concurrency tests (only when applicable)
(none — resume is sequential per session.)

#### Failure scenarios (external I/O)
- `test_resume_missing_storage_falls_back_deterministically` — no storage adapter → per-run
  in-memory (no crash; documented that durable resume needs a persistent adapter).

#### Acceptance Criteria
- `checkpoint_saved` emitted only when declared; resume re-hydrates by sessionId via SDK storage; no new store.

#### DoD
- 2+ RED tests green; resume proven deterministic; CHANGELOG updated.

## Phase 4: Deterministic E2E + the invariant guard

#### Objective
A deterministic E2E driving pause → approve → tool-runs → done + the deny path + a resume
assertion, and a guard test that the harness contains no parallel runtime.

#### Why this step (action + reasoning)
DoD-3's E2E + ADR 0038's enforcement teeth (invariant guard).

#### Evidence
- E2E discipline: the M2 `unified-agent-surface.test.ts` (SDK-stubbed, real ai reader).
- Invariant guard mirrors G2 (`grep` for LLM API URLs) + a "no reimplemented loop" assertion.

#### Files to edit
- `packages/agents/tests/integration/hitl-harness.test.ts` (new — SDK-stubbed: a gated tool → `pre_tool_call` fires → `tool-approval-request` on the reconstructed stream → resolve approve → tool runs → done; + deny → `tool-output-denied` + loop continues)
- `tests/unit/harness-invariant-guard.test.ts` (new — the harness files contain no LLM `fetch`/API URL; the loop is `runReflectiveLoop`, not a new loop)

#### Deep file dependency analysis
The E2E stubs `createSdkAgentStream`/the SDK to deterministically trigger a gated tool + honor the
plugin veto, then asserts the reconstructed `UIMessage`/chunks via the real ai reader (no live LLM).

#### Deep Dives
The E2E resolves the approval via the registry directly (in-process) to stay deterministic (no HTTP
round-trip needed for the unit-level E2E; the route is covered in Phase 2).

#### Tasks
- T4.1 HITL harness E2E (approve path + deny path).
- T4.2 Resume E2E (sessionId re-hydration) — may reuse T3.2 at integration level.
- T4.3 Invariant guard test.

#### TDD
- T4.1 RED: `test_e2e_hitl_pause_approve_runs_tool_then_done` + `test_e2e_hitl_deny_surfaces_denied_and_continues`.
- T4.3 RED: `test_harness_has_no_parallel_runtime` — grep the harness files for LLM API URLs (0)
  + assert `hitl-plugin`/`mount-agent` import `runReflectiveLoop`/`createSdkAgentStream` (reuse), not a new loop.

#### Concurrency tests (only when applicable)
(covered in Phase 1/2 registry concurrency tests.)

#### Failure scenarios (external I/O)
- The E2E deny + timeout paths ARE the failure scenarios (loop must continue, not crash).

#### Acceptance Criteria
- E2E green (approve + deny + resume); invariant guard green (no parallel runtime).

#### DoD
- E2E + guard green through the real ai reader; no live LLM; CHANGELOG updated.

## Phase 5: examples/agent-saas + CHANGELOG

#### Objective
A minimal `examples/agent-saas` that runs the harness (an `@Agent` with a HITL-gated tool +
`@Checkpoint`) — the DoD-3 named vehicle — and the CHANGELOG entry.

#### Why this step (action + reasoning)
DoD-3 names `agent-saas`; `examples/` has none. A minimal, real example is the honest DoD vehicle
(a pattern, not a framework primitive — consistent with the refined invariant).

#### Evidence
- `examples/` currently: `full-stack-agent`, `openrouter-demo`. The refined invariant (ADR 0038)
  keeps `examples/*` as patterns.

#### Files to edit
- `examples/agent-saas/` (new — a minimal app: `agents/ops.ts` with a HITL-gated `deploy` tool + `@Checkpoint`; a page consuming `useAgent` that renders the approval + approve action)
- `CHANGELOG.md` (Added — the harness)
- `.changeset/cohesive-harness.md` (`theokit` minor + `@theokit/agents` minor)

#### Deep file dependency analysis
The example depends only on the published/workspace `theokit` + `@theokit/agents` (the harness
surface). Its E2E is the Phase 4 test (deterministic); the example itself is the human-facing vehicle.

#### Tasks
- T5.1 `examples/agent-saas` minimal harness app.
- T5.2 CHANGELOG + changeset (both packages minor — additive harness API).

#### TDD
- T5.1: a structural test (`examples/agent-saas` has an agent with `@HumanInTheLoop` + a page using
  `useAgent`) — mirrors the template fixture tests. The behavioral proof is Phase 4's E2E.

#### Concurrency tests (only when applicable)
(none.)

#### Failure scenarios (external I/O)
(none new.)

#### Acceptance Criteria
- `examples/agent-saas` exists + wires the harness; CHANGELOG + minor changeset present.

#### DoD
- Example structural test green; CHANGELOG/changeset in place; ready for release.

## Coverage Matrix

| Goal claim (DoD) | Task(s) | Test |
|---|---|---|
| Scope ADR accepted before code (DoD-1, GATE) | ADR 0038 (done) | ADR file + invariant refinement committed |
| Harness packages loop + resume + HITL over run.stream, no reimplemented loop (DoD-2) | T1.*, T2.*, T3.*, T4.3 | translator + plugin + registry + resume tests + invariant guard |
| HITL rides ai-sdk approval chunks | T1.1, T2.3 | `tool-approval-request`/`tool-output-denied` schema-validated |
| Pause is the SDK async hook (not a new loop) | T1.2 | plugin awaits `pre_tool_call`; guard test |
| Resume reuses SDK storage by sessionId (no new store) | T3.2 | resume re-hydration test |
| agent-saas runs pause/resume + HITL E2E (DoD-3) | T4.1, T4.2, T5.1 | hitl-harness E2E (approve+deny) + resume + example structural |
| Deny/timeout continues coherently | T1.2 (timeout), T4.1 (deny) | timeout + deny tests |
| No parallel runtime (invariant, ADR 0038) | T4.3 | harness-invariant-guard |

## Test Plan

- **Unit:** translator approval chunks; HITL plugin (pause/allow/deny/timeout/concurrency); registry.
- **Integration:** HITL harness E2E (approve + deny) through the real ai reader (SDK stubbed); resume-by-sessionId.
- **Guard:** invariant test (no LLM fetch, no reimplemented loop) — ADR 0038's teeth.
- **Regression:** the M2 suite (49) stays green (non-HITL agents byte-unchanged); the M1 translator
  tests stay green (approval mapping is additive).
- **Oracle:** every emitted chunk validates against `uiMessageChunkSchema()` (reused from M1/M2).
