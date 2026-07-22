---
slug: agent-conversation-in-core
generated_by: roadmap-feature
new_milestone_id: M46
date: 2026-07-14
status: in_progress
---

# Feature grill — agent-conversation-in-core (M46)

## Q1 — What is this feature and why NOW?

Raise the client from per-turn raw `UIMessage[]` to a **surface-agnostic conversation `thread`**
in the React-free `theokit/client/core` store (`agent-client.ts`): committed history + in-flight
turn + streaming→committed lifecycle + id management. Scope = **P1 only** (the conversation-state
layer); the normalized message model + per-surface renderers (P2) are deliberately NOT in this
milestone.

**Why now:** dogfooding the showcase surfaced that every app hand-rolls the transcript plumbing —
`apps/showcase/app/hooks/use-transcript.ts` is **88 lines** of pure encanamento (separate `history`
state, `flatMap` of raw `parts`, fabricated ids because "the SDK's ids are empty", commit-once
`useEffect`, in-flight-vs-committed to avoid flicker). That boilerplate is re-written **per surface**
(web JSX / desktop JSX / TUI ink). M41–M45 removed the *transport* leak (`useAgent(path|transport)`)
but left the *conversation-state* leak. User-reported DX pain (2026-07-14). The store resets
`messages` to `[userMessage]` on every `send` (`agent-client.ts:137`) — the root of the boilerplate.
