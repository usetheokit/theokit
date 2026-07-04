# ADR 0038 — M4 cohesive harness: adapter scope + invariant refinement (GATE)

- **Status:** Accepted (owner sign-off — the M4 DoD-1 GATE; delegated "most SOTA/FAANG" 2026-07-04)
- **Date:** 2026-07-04
- **Milestone:** M4 (theokit-ai-first, Eixo C) — accepted BEFORE any harness code (the GATE)
- **Revisits:** the locked invariant `CLAUDE.md:253` ("Built-in agent orchestration = out of scope")
- **Relates:** ADR 0036 (canonical protocol UIMessageStream), ADR 0037 (unified agent surface)

## Context

M4 packages a cohesive harness — stateful loop + resume + HITL approval — "as an adapter over
`@theokit/sdk`, never a parallel runtime." DoD-1 is a GATE: the scope ADR must be accepted before
code and must **revisit** the locked invariant that bans built-in agent orchestration.

Discovery (`cohesive-harness-blueprint`) established:
- The runtime ALREADY exists and is SDK-owned: the reflective loop (`runReflectiveLoopStream`)
  **wraps** `run.stream()` (does not reimplement it); the SDK owns the loop, streaming, and
  conversation storage/resume (`ConversationStorageAdapter`).
- Two framework decorators SHIP TODAY as dead metadata: `@Checkpoint` + `CheckpointSavedEvent`
  (no producer) and `@HumanInTheLoop`/`@RequiresApproval` + `ApprovalRequiredEvent` (no producer,
  no consumer in the loop). Leaving them non-functional violates honest-enforcement (G10).
- The ai-sdk v7 `UIMessageStream` wire has NATIVE HITL: `tool-approval-request` /
  `tool-approval-response` / `tool-output-denied` chunks (in the `UIMessageChunk` union) that
  `@ai-sdk/react`'s `useChat` renders + resolves. M1 explicitly DEFERRED these chunks to M4.

## Decision

### D1 — The harness is an ADAPTER; the invariant is REFINED, not repealed (GATE)

The invariant bans a **parallel agent runtime / orchestration engine** — a second loop that calls
LLMs, dispatches tools, or owns conversation storage. The M4 harness does NONE of those: it drives
the EXISTING `runReflectiveLoop` (which wraps `run.stream()`), makes the ALREADY-SHIPPED
`@Checkpoint`/`@HumanInTheLoop` decorators functional, and persists via the SDK's storage adapter.
It contains **no LLM call, no tool dispatch, no second loop, no new store**. Therefore it is an
adapter, permitted. The invariant is refined to:

> **"A parallel agent runtime / orchestration engine is out of scope (the SDK owns that). Wiring
> the SDK's own primitives + the framework's shipped decorators into the app harness — HITL gates,
> resume, checkpoints — IS in scope: it is the 'home the agent lives in' (auth, sessions, human
> gates, deploy), which is the framework's wedge, not the SDK's job."**

This is the SOTA posture: Vercel ai-sdk, Mastra, and LangGraph all provide HITL/resume at the
app/framework layer over a runtime. `examples/*` remain patterns; the harness primitives (HITL,
checkpoint) become framework surface because they are app concerns.

### D2 — Surface: wire into the M2 `agents/*.ts` convention (NOT a new `createAgentApp`)

A new `createAgentApp` primitive would re-introduce the exact **dual path** M2 just eliminated
(two ways to define an agent app). The SOTA choice is a SINGLE convention: the agent DECLARES its
harness capabilities (HITL-gated tools, checkpoint strategy) on `defineAgent` / the existing
`@HumanInTheLoop`/`@Checkpoint` decorators, and `mountAgent` (the M2 wiring point) wires the
pause/resume/approval automatically. No new top-level API; the harness is the M2 endpoint made
stateful.

### D3 — HITL rides the ai-sdk-native UIMessageStream approval protocol

HITL is NOT a bespoke REST route. When a HITL-gated tool is about to run, the harness emits a
`tool-approval-request` chunk on the M2 `UIMessageStream` (the exact chunk `useChat` renders); the
client approves/denies via `tool-approval-response`; a denial surfaces as `tool-output-denied` and
feeds the loop a denial result so it continues coherently. This completes M1's deferred chunks +
reuses the ai-sdk ecosystem's own HITL convention (no invented second wire — ADR 0036).

### D4 — Resume/checkpoint reuses the SDK `ConversationStorageAdapter` (M3 reconciliation)

ROADMAP M4 risk-2 ("reuse `create-conversation-history`") is STALE: M3 deleted that theo file. The
SDK now owns storage. `@Checkpoint` persists via `ConversationStorageAdapter`; the `resumeToken`
is the `sessionId` (+ round); resume re-hydrates via `Agent.getOrCreate(sessionId, {
conversationStorage })`. No new store (do not resurrect `create-conversation-history`).

## Alternatives considered

- **Leave the decorators metadata-only** → violates G10 honest-enforcement; they ship as dead API.
- **Build a real orchestration engine (parallel runtime)** → violates the invariant; the SDK owns
  the loop.
- **`createAgentApp` primitive** → re-introduces the dual path M2 removed; more invariant tension.
- **Bespoke `/approve` REST route** → invents a second wire; the ai-sdk UIMessageStream already has
  native approval chunks (ADR 0036 canonical-protocol lock).

## Consequences

- `@Checkpoint`/`@HumanInTheLoop` become functional (dead metadata → wired). M1's deferred approval
  chunks ship.
- The M2 `agents/*.ts` endpoint gains HITL + resume when the agent declares them — one convention.
- The invariant's `CLAUDE.md` entry is updated to the refined wording (a separate governance edit,
  cited from this ADR).
- The enforcement guard (D5 of the blueprint): a review/code-quality check that the harness makes
  no LLM `fetch`, reimplements no loop, and creates no new store (the invariant's teeth).

## When this may change

Per the monorepo Locked Narrative governance — a further change to the refined invariant requires
another explicit strategic review + owner sign-off.
