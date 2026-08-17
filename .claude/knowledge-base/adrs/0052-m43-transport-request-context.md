# ADR 0052 — M43: request-context / auth parity across every transport

**Status:** Accepted (2026-07-12) — design GATE for M43 (accepted BEFORE code).
**Extends:** ADR-0050 (M41 `ChatTransport` seam + `AgentClient`), ADR-0051 (M42 `ChannelTransport`), ADR-0040 (runtime-vs-home).

## Context

`ai`'s `ChatTransport.sendMessages` already carries per-request `{ headers, body, metadata }`
(`ChatRequestOptions`), and M41's `HttpTransport` already forwards `headers` + `body` to its fetch. Two
gaps remain for "attach per-request context uniformly across every surface":

1. There is no way at the `useAgent` / `AgentClient` layer to SET per-request context — `send(input)`
   carries only the turn input, so an app cannot attach an auth token / tenant id / provider selection
   per request.
2. `InProcessTransport` and `ChannelTransport` IGNORE `headers`/`metadata` — they forward only the turn
   text to their runner / push source, so context never reaches the in-process / desktop surfaces.

## Decision

**D1 — One `RequestContext` channel via `ai`'s `ChatRequestOptions` (no bespoke channel).** Context is
`{ headers?: Record<string,string>; metadata?: unknown }`, threaded through the seam's EXISTING
`sendMessages({ headers, metadata })` — NOT a new interface (M41 D1 reuse). `body` stays the typed turn
input (unchanged). `headers` is the serializable, HTTP-native half; `metadata` is the structured,
same-process half.

**D2 — Each transport maps context to its NATIVE mechanism.**
- `HttpTransport` → `headers` become request headers (ALREADY wired in M41). `metadata` is NOT used by
  HTTP (it has no metadata slot; an app's HTTP context travels as headers). Documented, not silently dropped.
- `InProcessTransport` → forwards `metadata` to the injected runner as `InProcessRunInput.context`, so
  the sidecar/TUI runner (which binds `streamAgentTurnInProcess`) can read it (e.g. pick a provider).
- `ChannelTransport` → forwards `metadata` to the injected `source.start(turn)` as `turn.context`, so
  the Tauri `invoke` passes it to the sidecar.

**D3 — Context is resolved PER REQUEST (never stale).** `useAgent`'s `context` option is a
`RequestContext` OR a resolver `() => RequestContext | undefined`, evaluated on every `send`/`reconnect`
— reusing M41's `HeadersResolver` fix so a rotating JWT is always current. `AgentClient` holds a
`contextResolver`; `useAgent` passes `() => optionsRef.current.context` (the same live-ref pattern that
fixed M41's stale-headers HIGH finding).

**D4 — Runtime UNCHANGED (G2).** Context stops at the transport boundary → the app's server handler /
runner / invoke. The SDK loop is untouched; the SDK already takes per-run config, and this is the
app→transport plumbing that feeds it. M43 touches only `packages/theo/src/client/`.

**D5 — Back-compat is total.** A `send`/`useAgent` WITHOUT context behaves exactly as today across all
three transports (context is `undefined` → nothing added). The additions are optional fields.

## Consequences

- An app attaches auth/tenant/provider once (a `context` on `useAgent`) and it reaches EVERY surface:
  web via headers, terminal via the runner arg, desktop via the invoke arg — one uniform channel.
- No new dependency, no runtime change, no new interface — reuses `ChatRequestOptions` + the M41 store.
- Completes the seam's request model: input (`body`) + context (`headers`/`metadata`) both flow
  uniformly.

## Alternatives rejected

- **A new `context` interface separate from `ChatRequestOptions`** — reinvents what `ai` already models
  (M41 D1). Rejected.
- **Serialize `metadata` into HTTP headers/body for `HttpTransport`** — leaks a structured object into
  the wire ambiguously; an app's HTTP context belongs in explicit headers. `metadata` is the
  same-process channel for in-process/channel transports. Rejected (kept explicit per D2).
- **Thread context into the SDK runtime** — G2 breach; the SDK already takes per-run config, and context
  is app→transport plumbing that stops at the boundary. Rejected.
