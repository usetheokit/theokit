---
"theokit": minor
---

**M43 — request-context / auth parity across every transport.**

Attach per-request context — an auth token, a tenant id, a provider selection — once on `useAgent`, and
it reaches EVERY transport uniformly. `useAgent(pathOrTransport, { context })` accepts a `RequestContext`
(`{ headers?, metadata? }`) or a resolver evaluated on every send/reconnect (so a rotating JWT is never
stale — reuses M41's live-ref pattern). Each transport maps context to its native mechanism:
`HttpTransport` → `context.headers` become request headers; `InProcessTransport` → `context.metadata` is
forwarded to the runner as `InProcessRunInput.context`; `ChannelTransport` → `context.metadata` is
forwarded to the injected `start(turn)` as `turn.context`. Threaded through the seam's existing
`ChatRequestOptions` (`headers`/`metadata`) — no new channel. Context stops at the transport boundary
(never enters the SDK runtime — G2). Calls without `context` behave exactly as before (back-compat).
ADR-0052.
