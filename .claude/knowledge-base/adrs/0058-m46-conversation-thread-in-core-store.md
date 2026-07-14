# ADR 0058 — M46: surface-agnostic conversation `thread` in the core client store

**Status:** Accepted (2026-07-14) — design GATE for M46 (accepted at plan time, implemented under the cycle).
**Extends:** ADR-0050 (M41 unified client / `AgentClient` store over `ai`'s `ChatTransport`), ADR-0053 (M44 React-free `theokit/client/core`), ADR-0054 (M45 `--surface` scaffolder templates).

## Context

M41 unified every surface onto ONE client store (`AgentClient` → `useAgent` / `createAgentClient`), but
the store only ever exposed `messages` — the **current turn's** assistant messages, reset on every `send`
(`agent-client.ts` cleared `#messages` per send, and the SDK leaves the assistant message id empty). So
the actual conversation — history + the in-flight streaming turn — was NOT in the store. Every surface
re-implemented the SAME 88-line transcript by hand: a local `history` state, a `commit-once` effect on
stream end, an `inflightReply` merge with fabricated ids, and an ordering/duplicate-key dance:

- web default template + showcase (`app/hooks/use-transcript.ts`),
- TUI template (`surfaces/tui/tui/App.tsx.tmpl`),
- desktop template (`surfaces/desktop/frontend/src/App.tsx.tmpl`).

Three copies of subtle streaming state is a DRY violation (G12) and a dogfood pain: the "blink"/duplicate
class of bug lives exactly here. The conversation is store state, not view state — it belongs in the ONE
place all surfaces already inherit.

## Decision

**D1 — The store owns the conversation; add `thread` to `AgentClientState`.** `AgentClient` accumulates a
`thread: UIMessage[]` = committed turns + the current turn's user message + the in-flight assistant, built
in `#emit()`. `messages` keeps its EXACT per-turn back-compat semantics — `thread` is purely additive. All
surfaces inherit `thread` through the same snapshot they already read (`useSyncExternalStore` /
`getState()`), so the boilerplate deletes across web, desktop, and TUI at once. This is the "home the agent
lives in" wedge (ADR-0038 / G13 carve-out): a boundary/UX concern in framework core, reusing — not
reimplementing — the SDK runtime (G2 untouched; the store makes no LLM call and owns no storage engine).

**D2 — Commit-once on the next `send`, gated on `status === 'done'`.** The prior turn (user + assistant) is
appended to committed history exactly once, at the start of the next `send`, and ONLY when the prior turn
finished cleanly. An errored or aborted turn (`status !== 'done'`) is dropped, so committed history is never
corrupted by a partial/failed turn. This mirrors ai-sdk's finish-commit point but keeps it in TheoKit's
already-owned drive lifecycle (the `consumeChunkStream` completion), avoiding a second store.

**D3 — Fabricate a stable per-turn assistant id in the store.** The SDK leaves the streamed assistant
message id empty, which collides on render. The store stamps a `crypto.randomUUID()` per turn
(`#currentAssistantId`) so every chunk upserts into the SAME message and the committed copy has a
collision-free key. Id fabrication now happens ONCE, in the store — not re-invented per surface.

**D4 — The stale-drive abort guard extends to `thread`.** A superseded drive (older `AbortController`,
because a newer `send`/`abort` took over) must not append to `thread` after the fact — the same
race the store already handled for `messages`, proven by `test_stale_aborted_drive_does_not_append_to_thread`.

**D5 — Expose `thread` on all three surface bindings; codegen types it for free.** `useAgent().thread`,
`createAgentClient().getState().thread`, and — because the `@theo/agents` codegen emits the interface NAME
`UseAgentReturn<...>` (not a hand-written shape) — adding `thread` to that interface propagates to every
typed agent binding with ZERO codegen change. The surfaces collapse to `const { thread } = useAgent(...)`
(+ a prepended warm greeting): the 88-line web hook, the TUI App, and the desktop App each shed the
history/commit-once/inflight-merge block.

## Consequences

- One conversation model, one place: web (`useAgent`), desktop (`createAgentClient` over `ChannelTransport`),
  and TUI (`useAgent` over `InProcessTransport`) all render `thread` from the same store.
- The hand-rolled transcript is gone from the default template, the showcase, and both surface templates —
  the boilerplate M46 targeted for deletion.
- `messages` stays byte-for-byte back-compatible; existing consumers are untouched.
- Runtime (SDK) is untouched (G2): the store is a client boundary, not a second agent loop or storage engine.

## Alternatives rejected

- **Keep the transcript in each surface (status quo).** Three copies of subtle streaming state — the DRY
  violation and dogfood pain this milestone exists to remove.
- **A separate `useConversation` hook/store layered over `useAgent`.** A second store to keep in sync with
  the first; the accumulation belongs in the ONE store surfaces already inherit (D1), not beside it.
- **Reshape `messages` to hold the whole conversation.** Breaks every existing `messages` consumer; `thread`
  is additive precisely to preserve back-compat.
- **Commit on stream-end inside the drive instead of on next `send`.** Committing at `send` time lets the
  `status === 'done'` gate cleanly drop errored/aborted turns (D2) without a second effect racing the render.
