---
slug: agent-conversation-in-core
milestone_id: M46
created_at: 2026-07-14
goal: Add a surface-agnostic conversation `thread` to the React-free `AgentClient` store so `useAgent()`/`createAgentClient()` expose accumulated history+in-flight (committed once, stable ids) — collapsing the showcase's 88-line `use-transcript.ts` to one line — with the existing headless harness green and `messages` byte-unchanged.
---

# M46 — Conversation `thread` in the client core

## Goal

Add `thread: UIMessage[]` (committed turns + in-flight turn, accumulated across `send`, stable ids,
committed exactly once) to the React-free `AgentClient` store and expose it from `useAgent()` +
`createAgentClient()`, **additively** (raw `messages` unchanged). Single metric: `tests/unit/agent-client.test.ts`
(existing harness, extended) is green for thread accumulation across ≥ 2 turns + commit-once + abort +
error + reconnect, AND the showcase `apps/showcase/app/hooks/use-transcript.ts` (88 lines) is replaced by
`const { thread } = useAgent(...)` with the app still typechecking.

## Context

Prior art blueprint: `.claude/knowledge-base/discoveries/blueprints/agent-conversation-in-core-blueprint.md`
(SHIPPABLE_WITH_CAVEATS 89) — dissects ai-sdk `AbstractChat`/`ChatState` (`node_modules/ai/dist/index.d.ts:5481-5640`)
and opencode's transport-agnostic client (`knowledge-base/references/opencode/packages/sdk/js/src/v2/client.ts:50-93`).
It recommends: reuse `readUIMessageStream` (already used via `consume-ui-message-stream.ts`), OWN the `thread`
accumulation + id fabrication + commit-once in the store, detect stream-end natively (not ai-sdk's React-only
`onFinish`), keep the abort guard. M41–M45 unified the transport; the store still resets `#messages` per send
(`agent-client.ts` `send()`), so every app re-implements the transcript per surface. Grounded in
`.claude/rules/architecture.md` (client → core only; the M44 no-React invariant) and G12 (one store, no duplication).

## Prior Art & Related Work

- Blueprint above (internal, this cycle).
- ai-sdk `AbstractChat` conversation accumulation (`node_modules/ai/dist/index.d.ts:5481-5640`) — the SOTA pattern; reused via `readUIMessageStream`, not re-implemented (Rule 9).
- opencode transport-agnostic client (`knowledge-base/references/opencode/packages/sdk/js/src/v2/client.ts`) — "one client, per-surface injection" (matches TheoKit's M44 store).
- M41 plan (`.claude/knowledge-base/plans/unified-agent-client-transport-plan.md`) — the `AgentClient` store this extends.

## Baseline Context

Deep review at git `613e21e` (branch `develop`).

### Files that will be touched

| File | Role | Key facts | LoC |
|---|---|---|---|
| `packages/theo/src/client/agent-client.ts` | The store (extend) | `AgentClientState = {messages,status,error}` (:9); `buildUserMessage(input)` fabricates the USER id (:29); `#messages`/`#status`/`#error` + `#snapshot` (:53-57); `subscribe`/`getSnapshot` (:65/:73); `send()` resets `#messages` then drives the transport + `consumeChunkStream` (:105) upserting; abort guard on stale drives; `reset()` clears (:126). Assistant id NOT fabricated (the gap). | 187 |
| `packages/theo/src/client/consume-ui-message-stream.ts` | Stream accumulator (reuse) | `consumeChunkStream(stream,onMessage)` over `ai.readUIMessageStream` → `UIMessage`. The commit signal is this loop COMPLETING. | 71 |
| `packages/theo/src/client/use-agent.ts` | React hook (extend) | wraps `AgentClient` via `useSyncExternalStore`; returns `{messages,status,error,send,abort,reset,approve,reconnect,__toolNames?}`. Add `thread`. | 107 |
| `packages/theo/src/client/create-agent-client.ts` | No-React client (extend) | standalone `createAgentClient` over the same store (M44); exposes `getState`/`subscribe`/`stream`. Add `thread` to its state. | 126 |
| `packages/theo/src/vite-plugin/agents-typed-client.ts` | Typed codegen | generates `@theo/agents` `.d.ts` for `useAgent<K>`/`UseAgentReturn`. Add `thread` to the return type. | 202 |
| `tests/unit/agent-client.test.ts` | Headless harness (extend) | fakeTransport fixtures; commit/abort/error/reconnect assertions — NO React/DOM. M46 TDD lands here. | 180 |
| `apps/showcase/app/hooks/use-transcript.ts` | The 88-line proof | separate `history` + `flatMap(parts)` + fabricated assistant ids (:52/:78) + commit-once `useEffect` — the boilerplate M46 deletes. | 88 |

### Current callers / dependents

`AgentClientState` is consumed by `use-agent.ts` (`useSyncExternalStore` selector) and `create-agent-client.ts` (`getState`). Adding a field is additive — existing selectors read `messages`/`status`/`error` unchanged. `UseAgentReturn` is referenced by the `@theo/agents` codegen (`agents-typed-client.ts`) and every `useAgent()` call site (back-compat: additive field).

### Domain glossary

- **thread** — the accumulated conversation: committed turns + the current in-flight turn.
- **in-flight turn** — the assistant message being streamed for the current `send` (pre-commit).
- **commit-once** — appending the finished in-flight turn to committed history exactly one time, on stream-end.
- **fabricated id** — a store-minted stable id for an assistant message the SDK left id-empty.
- **abort guard** — the check that a stale (superseded) drive does not mutate state after a newer `send`.

### Architecture boundaries affected

`packages/theo/src/client/` only (client → core; no server/runtime/transport change — G2 / `sdk-runtime.md` carve-out). No new dependency (`ai` already peer). Dependency direction unchanged.

## ADRs

### ADR-1 — `thread` lives in the `AgentClient` store (not a new store, not a React hook)

**Decision:** add `thread` to `AgentClientState` in `agent-client.ts`; `useAgent`/`createAgentClient` expose it by reading the store snapshot.

**Rationale:** the 3-surface constraint (`architecture.md`, M44 no-React invariant) requires the logic in the React-free core so React (`useAgent`), Ink, and vanilla (`createAgentClient`) all inherit it (G12 — one store, no duplication). Reuses ai-sdk `readUIMessageStream` via the existing `consumeChunkStream` (Rule 9).

**Alternatives rejected:** (a) a React `useConversation` hook — leaves TUI/vanilla out (breaks the milestone's 3-surface DoD); (b) a separate `ConversationStore` — duplicates the store's subscribe/snapshot machinery + risks drift (G12); (c) adopt ai-sdk `useChat` — already rejected by the M41 transport ADR (React dep, heavier surface, back-compat break).

### ADR-2 — Commit-once on native stream-end, NOT ai-sdk's `onFinish`

**Decision:** the commit signal is the `consumeChunkStream` loop completing (stream-end), after which the store fabricates the assistant id (if empty), appends the in-flight turn to committed history, and emits once.

**Rationale:** ai-sdk's `onFinish` belongs to `AbstractChat` (a React wrapper); TheoKit's store is a plain class. The store already transitions status when the stream ends (`agent-client.ts:~101`) — that same point is the commit signal (no extra wiring, no `AbstractChat` type-bleed).

**Alternatives rejected:** (a) wire `ChatInit.onFinish` — imports `AbstractChat` internals into a framework-free core (coupling); (b) commit per-chunk — would duplicate/flicker (the exact showcase bug).

### ADR-3 — Additive; raw `messages` semantics frozen

**Decision:** `thread` is a NEW field; `messages` keeps its EXACT current per-turn semantics (reset each send).

**Rationale:** back-compat (R1) — existing `useAgent().messages` call sites must not change behavior. Docs steer new code to `thread`.

**Alternatives rejected:** (a) redefine `messages` to be the conversation — breaks every current consumer (silent behavior change, Rule 3 violation).

## Dependency Graph

Phase 1 (store accumulation) → Phase 2 (surface exposure + codegen) → Phase 3 (3-surface validation). Phase 2 depends on Phase 1's `thread` field; Phase 3 depends on Phase 2's exposed `thread`. No parallelism (linear).

## Phases

### Phase 1 — `thread` accumulation in the store

**Task 1.1 — `AgentClientState.thread` + accumulate committed history + in-flight, commit-once with fabricated ids.**
- **Files to edit:** `packages/theo/src/client/agent-client.ts`.
- **Why this step:** the store is the single home all surfaces inherit (ADR-1). Owning accumulation + id-fabrication + commit-once here (ADR-2) is what deletes the per-surface boilerplate. Reasoning: the blueprint proves ai-sdk accumulates in `ChatState` and commits on finish; TheoKit's equivalent commit point is the `consumeChunkStream` completion (`agent-client.ts:~101/:105`), so the append-to-thread happens there.
- **Deep dependency analysis:** `AgentClientState` (:9) is read by `use-agent.ts` + `create-agent-client.ts` via snapshot — adding `thread` is additive (existing selectors untouched). `#snapshot` (:57/:76) must include `thread`. The abort guard (stale drive) must NOT append to `thread`.
- **TDD (RED first):** in `tests/unit/agent-client.test.ts` — `test_thread_accumulates_across_two_sends` (drive fakeTransport turn 1 → thread has [user1, assistant1] committed with non-empty ids; drive turn 2 → thread has [user1,assistant1,user2, in-flight assistant2]); `test_thread_commits_inflight_exactly_once_on_stream_end` (no duplicate assistant entry); `test_thread_assistant_id_is_fabricated_and_stable_when_sdk_empty`. Assertion API: `expect(client.getSnapshot().thread...)`.
- **Failure scenarios:** stream errors mid-turn → see `## Failure scenarios`.
- **Concurrency tests:** `test_stale_aborted_drive_does_not_append_to_thread` — a superseded drive (older AbortController) must not mutate `thread` after a newer `send` (the abort-guard race the store already handles for `messages`, now for `thread`).
- **Acceptance:** `getSnapshot().thread` = committed + in-flight; ids non-empty + stable; commit-once; `messages` unchanged.
- **DoD:** `npx vitest run tests/unit/agent-client.test.ts` green; `agent-client.ts` stays < 500 LoC (G6); no new dep.

### Phase 2 — Expose `thread` on both surfaces + codegen typing

**Task 2.1 — `useAgent()` + `createAgentClient()` return `thread`; `@theo/agents` codegen types it.**
- **Files to edit:** `packages/theo/src/client/use-agent.ts`, `packages/theo/src/client/create-agent-client.ts`, `packages/theo/src/vite-plugin/agents-typed-client.ts`, `packages/theo/src/client/index.ts` (barrel type export if needed).
- **Why this step:** DoD requires all three surfaces get `thread`. The hook + no-React client read the store snapshot; the codegen must add `thread` to `UseAgentReturn` so consumers see it typed. Reasoning: additive to `UseAgentReturn` — no call site breaks (ADR-3).
- **Deep dependency analysis:** `use-agent.ts` `useSyncExternalStore` selector already returns the snapshot; add `thread: state.thread`. `create-agent-client.ts` `getState` returns snapshot; add `thread`. `agents-typed-client.ts` emits `UseAgentReturn<...>` — add `thread: UIMessage[]` to the generated type + the runtime type.
- **TDD (RED first):** `tests/unit/use-agent-unified.test.tsx` (or extend) — `test_useAgent_exposes_thread_from_store`; `tests/unit/create-agent-client.test.ts` — `test_createAgentClient_getState_includes_thread`; `tests/unit/agents-typed-client*.test.ts` — the generated `.d.ts` contains `thread`.
- **Concurrency tests:** (none — pure selector passthrough over the store's already-tested accumulation).
- **Acceptance:** both surfaces return `thread`; generated `.d.ts` types it; `messages` still returned.
- **DoD:** touched suites green; `tsc --noEmit` clean; codegen snapshot updated.

### Phase 3 — Integration Validation (the 3-surface "eat your own cooking" gate)

**Task 3.1 — Collapse showcase `use-transcript.ts`; TUI/desktop templates consume `thread`; full validation.**
- **Files to edit:** `apps/showcase/app/hooks/use-transcript.ts` (collapse to `thread`), the M45 `create-theokit` TUI + desktop surface templates (consume `thread`), `packages/theo/CHANGELOG.md`, `docs/agents/*` (a "one conversation, every surface" note), `.claude/knowledge-base/adrs/0058-*.md` (ADR).
- **Why this step:** the Goal's single metric + the 3-surface DoD. Proves the boilerplate is actually gone and every surface uses the same `thread`.
- **TDD:** the showcase still typechecks (`pnpm --filter showcase typecheck` / the app's tsc) with `use-transcript.ts` reduced; a surface-parity assertion that the TUI/desktop templates reference `thread` (scaffold-template test, per M45's pattern).
- **Failure scenarios:** malformed stream → the store's error path (Phase 1) surfaces without corrupting `thread`.
- **DoD:** full `pnpm --filter theokit test` green (baseline + new); `tsc --noEmit` clean; `eslint packages/ --max-warnings=0`; showcase `use-transcript.ts` ≤ ~10 lines; CHANGELOG (`minor`) + ADR-0058 written; changeset.

## Coverage Matrix

| Goal/DoD claim | Task |
|---|---|
| `thread` in `AgentClientState`, accumulated across sends, committed once, stable ids | 1.1 |
| abort/stale drive does not corrupt thread | 1.1 |
| `useAgent()` + `createAgentClient()` return `thread`; codegen types it | 2.1 |
| raw `messages` unchanged (back-compat) | 1.1, 2.1 |
| validated on 3 surfaces (showcase collapse + TUI/desktop templates) | 3.1 |
| reconnect replays into same thread; error mid-stream coherent | 1.1 (failure scenarios) |
| runtime/wire untouched (G2); no new dep | 1.1 (ADR-1/DoD) |
| docs + CHANGELOG + ADR + changeset | 3.1 |

100% — every claim mapped.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Mental-model / back-compat shift (R1): `messages` is per-turn; adding `thread` risks "which do I use?" confusion or breakage if `messages` semantics drift | HIGH | ADR-3 freezes `messages` semantics; a back-compat regression test proves it byte-unchanged | impl |
| Id/lifecycle correctness (R2): the store now owns id fabrication + commit-once + in-flight/committed dedup — risk of double-commit, id collision, flicker, or lost turn on abort/reconnect/error | HIGH | TDD the lifecycle (Task 1.1 concurrency tests + failure scenarios: abort, reconnect, error mid-stream, empty/colliding id) | impl |
| Unbounded `thread` growth in long conversations (no window) | LOW | Out of scope for M46 (same as any chat UI); a cap/window is a follow-up if a shipped app hits it | deferred |

## Unresolved Questions

- Q1: Should `reset()` clear `thread` too (start a fresh conversation) or only the in-flight turn? *Resolution:* `reset()` clears BOTH (`thread` + in-flight) — it means "new conversation" (matches the showcase's reset semantics); confirmed at Task 1.1.
- Q2: For non-`{message}` typed inputs, does the user `thread` entry render a text part or the raw input? *Resolution:* mirror today's `buildUserMessage` (text part from `input.message` or `JSON.stringify(input)`) — no change; recorded, does not block.

## Failure scenarios

External I/O = the transport stream (already owned by M41 transports; M46 only accumulates its output).

| Scenario | Expected behavior | Test |
|---|---|---|
| Stream errors mid-turn | `status:'error'` + `error` set; the partial in-flight turn is NOT committed to `thread` (no corrupt history); committed history intact | `test_error_mid_stream_does_not_corrupt_thread` (Task 1.1) |
| Abort mid-turn | in-flight turn dropped or left uncommitted per abort semantics; committed history intact; no `error` (abort ≠ error) | `test_abort_mid_turn_leaves_committed_thread_coherent` (Task 1.1) |
| Reconnect (M37) after a drop | the reconnect stream accumulates into the SAME in-flight turn, then commits once; no duplicate turn | `test_reconnect_replays_into_same_thread` (Task 1.1) |

## Global DoD

- All task tests green; `pnpm --filter theokit test` (baseline + new) green; `tsc --noEmit` clean; `eslint packages/ --max-warnings=0`.
- `agent-client.ts` < 500 LoC (G6); every new export has a caller/test (G7); no new dependency (G2/Rule 9).
- `messages` byte-behavior unchanged (back-compat regression green).
- Showcase `use-transcript.ts` collapsed (≤ ~10 lines) + app typechecks; TUI/desktop templates reference `thread`.
- ADR-0058 written; CHANGELOG (`minor`) + changeset; docs note.
