# Blueprint: Cohesive harness — adapter over the SDK (M4 — Eixo C)

> **Exec summary.** M4 packages a cohesive harness — stateful loop + resume + HITL approval —
> as an **adapter/wiring over `@theokit/sdk`**, NOT a parallel runtime. Discovery proves the
> runtime already exists: the reflective loop (`runReflectiveLoopStream`,
> `packages/agents/src/loop/run-reflective-loop.ts:457`) **wraps** `run.stream()` (it does NOT
> reimplement the SDK loop), `AgentRunner` (`loop/agent-runner.ts:173`) is the imperative
> on-ramp, and the SDK owns the loop + streaming + conversation storage + resume. The M4 GAP is
> that two decorators are **declared but never wired**: `@Checkpoint` (`decorators/checkpoint.ts:64`)
> + `CheckpointSavedEvent` (`agent-stream-events.ts:128`) have NO producer, and
> `@HumanInTheLoop`/`@RequiresApproval` (`decorators/human-in-the-loop.ts:44`,
> `policies.ts:12`) + `ApprovalRequiredEvent` (`agent-stream-events.ts:59`) emit nothing in the
> loop. So M4 = **wire the existing metadata into the existing loop stream + package it as an
> app-level harness over the M2 `agents/*.ts` surface** — pure adapter, zero new runtime.
>
> **Verdict: (to be scored by /discover-confidence)**

### The invariant tension (the ADR-gate's whole reason to exist)

CLAUDE.md:253 locks: *"Built-in agent orchestration = out of scope. `examples/agent-saas` and the
default template show how to wire an agent — they're patterns, not framework primitives. Agent
orchestration belongs upstream in the SDK / Mastra / Vercel AI SDK."* M4 DoD-1 explicitly
**revisits** this. The resolution the discovery supports: the invariant bans a **parallel
runtime / orchestration engine** (a second loop that calls LLMs / dispatches tools). It does NOT
ban **wiring the SDK's own primitives + the framework's already-shipped decorators into an app
surface.** `@Checkpoint`/`@HumanInTheLoop` are ALREADY framework decorators (M8-era) — leaving
them metadata-only is the honest-enforcement violation (G10 / CLAUDE.md "silence is the most
dangerous tech debt"). Wiring them is completing shipped surface, not new orchestration.

### The M3 reconciliation (ROADMAP risk-2 is stale)

ROADMAP M4 risk-2 says "reuse the existing `create-conversation-history` / `@Checkpoint`". **M3
DELETED `create-conversation-history`** (theo's own storage) — the SDK now owns storage. The
correct reuse is the SDK's `ConversationStorageAdapter` (`FileSystemConversationStorage` /
`InMemoryConversationStorage`), which `sdk-adapter.ts:127-130` already threads via
`conversationStorage`. M4 resume/pause reuses THAT, never a new store. `@Checkpoint` stays (it's
in `@theokit/agents`, untouched by M3).

---

## Coverage Corner 1 — Integration Tests

- **The existing loop is tested** — `runReflectiveLoopStream` has V4-B/C/D coverage (terminals
  `no_progress`/`step_limit`). The M4 tests EXTEND, not replace.
- **HITL E2E (DoD-3):** the DoD names `agent-saas` running pause/resume + human approval E2E. But
  `examples/` has only `full-stack-agent` + `openrouter-demo` — **no `agent-saas`**. The E2E
  target is either (a) a new minimal `agent-saas` example, or (b) an integration test that drives
  the harness through: stream → `approval_required` → pause → approve callback → resume → done.
  Deterministic (SDK stubbed to request a gated tool), mirroring the M2/M3 E2E discipline.
- **Checkpoint/resume test:** stream with a checkpoint strategy → `checkpoint_saved` emitted →
  a second request with the `resumeToken`/sessionId re-hydrates from the SDK storage (assert the
  loaded history, no re-run of prior rounds).

## Coverage Corner 2 — Dependencies

- **No new dependency.** All runtime is `@theokit/sdk` (loop/storage) + `@theokit/agents`
  (`runReflectiveLoop`, `AgentRunner`, the decorators). M4 is wiring TS in `@theokit/agents`
  (harness/HITL producers) + possibly a thin theo-side route (approval callback endpoint over M2).
- **Cross-package:** the harness core lives in `@theokit/agents` (it owns the loop + decorators).
  A `theo`-side HTTP surface (approval/resume routes over the M2 `agents/*.ts` endpoint) is
  optional wiring — keep the runtime in agents, the HTTP glue in theo (dep direction preserved).

## Coverage Corner 3 — Tools

- `runReflectiveLoopStream` (existing) — the loop the harness drives, unchanged.
- The SDK `ConversationStorageAdapter` — the resume/checkpoint store (reuse, don't reinvent).
- The SDK permission-plugin hook (`createPermissionPlugin`, `pre_tool_call`) — the SDK-level seam
  the HITL producer can use to gate a tool + emit `approval_required` (the SDK has NO public HITL
  API; the plugin veto point is the sanctioned seam).
- Existing events (`ApprovalRequiredEvent`, `CheckpointSavedEvent`) — the wire the harness emits.

## Coverage Corner 4 — Techniques

### The harness = wire the unwired decorators into the loop stream

1. **HITL producer.** When the compiled agent declares `@HumanInTheLoop`/`@RequiresApproval` for a
   tool, the loop (or the SDK permission plugin) intercepts that tool's `pre_tool_call`, emits an
   `ApprovalRequiredEvent` (callId, toolName, question, input), PAUSES the stream, and awaits a
   consumer-provided `approve(callId) → boolean`. On approve → proceed; on deny/timeout → skip the
   tool (feed a denial result to the loop, which continues). This is the `@HumanInTheLoop.onTimeout`
   contract made functional.
2. **Checkpoint producer.** When `@Checkpoint({ strategy: 'after-tool-call' | 'after-iteration' })`
   is declared, the loop persists `CheckpointState` (via the SDK storage) at the strategy point and
   emits `CheckpointSavedEvent` with a `resumeToken` (= the sessionId + round). Resume = a request
   carrying the token → `Agent.getOrCreate(sessionId, { conversationStorage })` re-hydrates.
3. **App-level packaging.** A thin surface — provisionally `createAgentApp` OR (leaner) wiring the
   HITL/resume into the M2 `mountAgent` path + a `POST /api/agents/<name>/approve/<callId>` route.
   The scope ADR picks between the two (see ADRs).

### The `run.stream()` contract the harness must NOT reimplement (from the SDK explore)

- SDK owns: `Agent.getOrCreate(sessionId, {..., conversationStorage})`, the `send(onDelta)` +
  `run.stream()` merge (real-time tokens + post-completion structural, deduped), `run.wait()`
  (terminal usage/cost), storage. The harness wires; it never calls an LLM or dispatches a tool.

---

## ADRs (the DoD-1 GATE)

### ADR-D1 — Harness IS an adapter; it does NOT violate the orchestration invariant (GATE)

- **Context.** CLAUDE.md:253 locks "built-in agent orchestration out of scope". M4 packages loop +
  resume + HITL. Does this cross the line?
- **Decision.** The harness is defined as **wiring**: it drives the EXISTING `runReflectiveLoop`
  (which wraps `run.stream()`), makes the ALREADY-SHIPPED `@Checkpoint`/`@HumanInTheLoop`
  decorators functional (they emit events + pause via the SDK plugin seam), and persists via the
  SDK's `ConversationStorageAdapter`. It contains **no LLM call, no tool dispatch, no second loop,
  no new store** — the four things the invariant bans. Therefore it is an ADAPTER, permitted.
- **Alternatives.** (a) Leave the decorators metadata-only forever → violates honest-enforcement
  (G10). (b) Build a real orchestration engine (parallel runtime) → violates the invariant.
  Rejected.
- **Consequence.** The invariant is REFINED, not repealed: "orchestration = a parallel runtime is
  out of scope; wiring the SDK + shipped decorators into an app harness is in scope." Requires
  owner sign-off (locked-invariant revisit).

### ADR-D2 — Scope: wire into the M2 surface vs a new `createAgentApp` primitive (GATE)

- **Option A (leaner, recommended):** wire HITL + checkpoint/resume into the EXISTING M2
  `agents/*.ts` path (`mountAgent`/`streamAgentUIMessages`) + one approval-callback route. No new
  top-level primitive; the harness is the M2 endpoint made stateful. Maximally "adapter", reuses
  M2, minimal new API surface (KISS/YAGNI).
- **Option B (ROADMAP-literal):** a new `createAgentApp(AgentClass)` app-level surface holding an
  `AgentRunner` + session bag + routes. More new API; more invariant tension; but matches the
  ROADMAP's named example.
- **Decision:** deferred to the gate — recommend **A** (complete the M2 surface) unless the owner
  wants the named `createAgentApp` primitive.

### ADR-D3 — Resume/pause storage reuses the SDK adapter (M3 reconciliation)

- **Decision.** Reuse the SDK `ConversationStorageAdapter` (the deleted `create-conversation-history`
  is NOT resurrected). `@Checkpoint`'s `resumeToken` = sessionId(+round); resume re-hydrates via
  `Agent.getOrCreate(sessionId, { conversationStorage })`.

---

## Edge cases (to settle in PLAN)

- **EC-1 — approval timeout.** `@HumanInTheLoop.onTimeout` (abort/proceed/retry) must be honored;
  a hung approval must not leak the paused stream (AbortSignal + timeout).
- **EC-2 — deny feeds the loop.** A denied tool call feeds a denial tool-result so the reflective
  loop continues coherently (not a crash).
- **EC-3 — resume determinism.** Re-hydrating from storage must NOT re-run already-completed rounds
  (the SDK loads prior turns; assert no duplicate tool execution).
- **EC-4 — UIMessageStream mapping.** `approval_required` / `checkpoint_saved` must map onto the M2
  `UIMessageStream` (a `data`/`tool` part) OR a documented side-channel — the M2 wire is the
  canonical client protocol; do not invent a second wire (M1 ADR 0036).
- **EC-5 — no parallel runtime (the invariant guard).** A code-quality/review guard asserting the
  harness contains no LLM `fetch` + does not reimplement the loop (grep guard, mirrors G2).

## References

- ROADMAP M4; the locked invariant `CLAUDE.md:253`.
- Existing loop: `packages/agents/src/loop/run-reflective-loop.ts`, `agent-runner.ts`, `agent-orchestrator.ts`.
- Unwired decorators: `packages/agents/src/decorators/{checkpoint,human-in-the-loop,policies}.ts`; events `packages/agents/src/bridge/agent-stream-events.ts:59,128`.
- SDK contract: `packages/agents/src/bridge/sdk-adapter.ts` (getOrCreate/send/stream/wait/storage); SDK types at `../theokit-sdk/packages/sdk/src/types/`.
- M2 surface to extend: `packages/theo/src/server/agent/mount-agent.ts`, `packages/agents/src/bridge/agent-endpoint.ts`.
- M3 storage reconciliation: `create-conversation-history` deleted; SDK `ConversationStorageAdapter` is the store.
