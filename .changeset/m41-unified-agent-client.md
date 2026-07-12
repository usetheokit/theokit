---
"theokit": minor
---

**M41 — Unified typed agent client on the AI SDK `ChatTransport` seam (web + TUI).**

`useAgent` is now ONE hook over one seam, driving the agent identically on every surface. It adopts the
AI SDK's `ChatTransport` (already a peer dependency) as the transport interface and ships two
implementations: `HttpTransport` (web — wraps the existing `POST /api/agents/<name>` UIMessageStream SSE,
the `x-theokit-run-id` header, and the M37 durable reconnect endpoint, byte-identical to before) and
`InProcessTransport` (terminal/desktop — wraps `streamAgentTurnInProcess`; `reconnectToStream` → `null`,
mirroring the AI SDK's `DirectChatTransport`). `useAgent(pathOrTransport)` drives both: pass a path string
(web, wrapped in `HttpTransport`) or an `AgentTransport` (the TUI passes an `InProcessTransport`). The
hook's logic lives in a framework-agnostic `AgentClient` store bound via React's native
`useSyncExternalStore` — no new dependency.

The return shape gains two additive methods (existing call sites keep working): `approve(id, decision)`
settles a paused HITL approval via the transport's HITL path (HTTP `POST /approve/<id>` for web; the
inline callback in-process), and `reconnect()` resumes an interrupted stream (M37 for web; a no-op
in-process). The generated `@theo/agents` client keeps the name-typed `useAgent<K>(name)` overload and
adds a `useAgent(transport)` overload. Runtime, agent definition, and compile are untouched (client /
boundary only — G2). Foundation of the theokit↔sdk integration DX track: M42 (Tauri `ChannelTransport` +
reconnect parity), M43 (request-context/auth parity), M44 (standalone typed client-SDK) build on the same
seam. See ADR-0050.
