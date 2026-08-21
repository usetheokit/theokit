---
'theokit': patch
---

Every agent endpoint now emits an HTTP span, and one agent is one series.

**The aux and approve routes were invisible at the HTTP layer.** `POST /api/agents/<name>` ran the
plugin lifecycle; the six routes beside it did not, in production or in dev. So the thread message
and stream routes, MCP, the agent card, the pending-approvals listing, the durable run-stream
reconnect and the HITL approve route answered without `onRequest` / `onResponse` / `onError` — no
`http.request` span, no `http.requests`, no `http.errors`. Two of those spend tokens and one settles
a human decision, and an operator watching latency or error rate saw no traffic for them, which
reads exactly like no traffic. The thread route's `agent.run` spans did arrive, so a trace showed a
run with no request above it.

The lifecycle bracket is now one function (`serveThroughPluginLifecycle`) applied by every agent
branch in both surfaces, and the aux dispatcher decides ownership (`matchAgentAuxRoute`) before it
answers (`serveMatchedAuxRoute`) — which is what makes a bracket possible without converting a
request in order to learn whose path it is. A seventh aux route added later inherits the lifecycle
instead of having to remember it.

**`theokit dev` also stopped 404ing four routes `theokit start` serves.** The dev middleware kept a
hand-maintained subset of the dispatcher's route table (approvals and MCP), so the two thread routes
and the durable run-stream reconnect were production-only. It now asks the table.

**The `agent` span attribute is the agent's name on every route.** It was the agent module's
absolute filesystem path on `POST /api/agents/<name>` and the string `agent "chat"` on the thread
route, so the same agent split into two series on a dashboard, the path form changed with every
deploy and directory rename, and the server's directory layout — on a developer machine, the user's
account name — was exported to the telemetry backend on every span of every run. The compile label
that names a fail-fast `AgentDefinitionError` stays human-readable; it is simply no longer the key
an operator groups by. The module path is not emitted under another name either: if it is ever
wanted, `code.filepath` is the registry spelling and it is an opt-in, not a default.
