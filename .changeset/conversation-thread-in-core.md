---
"theokit": minor
"create-theokit": minor
---

`useAgent` now exposes the whole conversation as `thread`, not just the current turn (M46, #125, ADR-0058).

The client store (`theokit/client/core`) accumulates a surface-agnostic `thread: UIMessage[]` — committed turns + the current user message + the in-flight streaming assistant — with stable message ids, committed exactly once, cleared only by `reset()`. Render `const { thread } = useAgent(...)` (or `createAgentClient(...).getState().thread` from the React-free core) instead of hand-rolling a transcript from per-turn `messages`. Same shape on web, desktop (Tauri) and TUI.

- Per-turn `messages` keeps its exact back-compat semantics — `thread` is purely additive; existing call sites are untouched.
- The `@theo/agents` codegen types `thread` automatically (it emits the `UseAgentReturn` interface name).
- An errored or aborted turn is dropped rather than corrupting committed history; stale (aborted) drives never append.
- **create-theokit:** the scaffolded web, TUI, and desktop apps now render `useAgent().thread` directly — the ~88-line hand-rolled transcript (local history + commit-once effect + inflight-merge) is gone from all three surface templates.
