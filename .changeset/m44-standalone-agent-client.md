---
"theokit": minor
---

**M44 — standalone typed agent client-SDK (no React) over the same store.**

Consume an agent from a node script, a CLI, a test, or a non-React UI — the same seam, no React in your
bundle. `createAgentClient(transport, { context? })` (from the new React-FREE entry `theokit/client/core`)
returns a plain handle over the framework-agnostic `AgentClient` store: `send` / `abort` / `reset` /
`approve` / `reconnect` / `subscribe` / `getState`, plus an ergonomic `stream(input): AsyncIterable<UIMessage>`
that yields the assistant message as it streams (the last value is the final result; a failed turn rejects
the iterator). It drives ANY transport (`HttpTransport` over node fetch, `InProcessTransport`,
`ChannelTransport`) and supports the M43 per-request `context`. `theokit/client/core` imports no React
(verified by an import-graph test); `theokit/client` also re-exports `createAgentClient` for React apps'
convenience. No new store (wraps the existing `AgentClient` — G12), no runtime change (G2). Completes the
theokit↔sdk DX track (M41 web+TUI, M42 Tauri, M43 context, M44 standalone). ADR-0053.
