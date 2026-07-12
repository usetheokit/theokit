# The agent client — one hook, every surface (`useAgent`)

**Status:** M41 (ADR-0050). Write the agent once; consume it identically on web and terminal.

TheoKit compiles every `agents/<name>.ts` to the same runtime on every surface. M41 makes the **client**
match: one hook, `useAgent`, drives the agent whether it runs over HTTP (web) or in the same process
(a terminal/desktop app) — with the same return shape and the same `approve` / `reconnect` methods.

## The seam: `ChatTransport`

`useAgent` drives an **`AgentTransport`** — the AI SDK's own [`ChatTransport`](https://sdk.vercel.ai)
interface (`sendMessages` + `reconnectToStream`) plus one optional method, `approve`, for TheoKit's
out-of-band human-in-the-loop. TheoKit ships two transports; you rarely construct them by hand on the web.

| Surface | Transport | How `useAgent` gets it |
|---|---|---|
| **Web** (and any HTTP client) | `HttpTransport` | Pass a path string — `useAgent('/api/agents/chat')` wraps it in an `HttpTransport` for you. |
| **Terminal** (single process) | `InProcessTransport` | Construct it over the in-process seam and pass it — `useAgent(transport)`. |
| **Tauri desktop** (webview ↔ Node sidecar) | `ChannelTransport` | Wrap the Tauri `Channel`/`invoke` push in a source and pass it — `useAgent(channelTransport)`. |

## Web

```tsx
import { useAgent } from '@theo/agents' // typed by agent name (generated)

function Chat() {
  const { messages, status, error, send, abort, reset, approve, reconnect } = useAgent('chat')
  // send({ message }) is typed to the agent's `input` schema — zero manual wiring.
  return <button onClick={() => send({ message: 'hi' })}>Ask</button>
}
```

The wire is unchanged from before M41: `POST /api/agents/<name>` (UIMessageStream SSE, `X-Theo-Action`
CSRF header), the durable `x-theokit-run-id`, and the M37 reconnect endpoint. Existing `useAgent('/path')`
call sites keep working — the return shape only GAINED `approve` and `reconnect` (additive).

## Terminal / desktop (in-process)

An Ink TUI or a Tauri window runs the agent in the SAME process — no HTTP. Bind the in-process seam
into an `InProcessTransport` and pass it to the same hook:

```tsx
import { useAgent, InProcessTransport } from 'theokit/client'
import { streamAgentTurnInProcess } from 'theokit/server'
import { useMemo } from 'react'

function TuiChat({ mod, apiKey }: { mod: unknown; apiKey: string }) {
  // Memoize the transport — the store is created once per binding identity.
  const transport = useMemo(
    () => new InProcessTransport({ run: (input) => streamAgentTurnInProcess(mod, apiKey, input) }),
    [mod, apiKey],
  )
  const { messages, status, send, approve } = useAgent(transport)
  // Same hook, same return shape as the web example above.
}
```

`InProcessTransport.reconnectToStream()` is a no-op that returns `null` (a single process has no dropped
server stream to resume — matching the AI SDK's `DirectChatTransport`).

## Tauri desktop (push over a `Channel`)

The M36 desktop app runs the agent in a Node sidecar that writes each `UIMessageChunk` as a JSONL line
to stdout; the Rust shell pushes each line to the webview via a Tauri `Channel` (ADR-0045). Give the
webview the SAME `useAgent` with a `ChannelTransport` over an injected push source — core imports no
`@tauri-apps/*` (the source is structural, so the transport is also testable with a fake):

```tsx
import { useAgent, ChannelTransport, type ChannelPushSource } from 'theokit/client'
import { Channel, invoke } from '@tauri-apps/api/core'
import { useMemo } from 'react'

const source: ChannelPushSource = {
  start(turn, { onLine, onClose }) {
    const channel = new Channel<string>()
    channel.onmessage = onLine
    void invoke('run_agent', { message: turn.message, channel }).then(onClose)
    return () => void invoke('abort_agent') // teardown on abort/cancel
  },
  settle: (id, decision) => invoke('approve_agent', { id, decision }),
}

function DesktopChat() {
  const transport = useMemo(() => new ChannelTransport({ source }), [])
  const { messages, status, send, approve } = useAgent(transport)
  // Same hook, same return shape as web + terminal.
}
```

`ChannelTransport.reconnectToStream()` returns `null` — the sidecar runs the turn directly (no durable
server stream), the same honest parity as `InProcessTransport`. A malformed pushed line is skipped, never
fatal. `approve` routes to the injected `settle` (another `invoke`).

## Human-in-the-loop: one `approve`

When a gated tool pauses a run, settle it with `approve(approvalId, { approved, reason?, payload? })` —
the same method on every surface. It routes to the transport's HITL path:

- **Web** — `POST /api/agents/<name>/approve/<approvalId>` (the approval registry unblocks the run).
- **In-process** — resolves the inline `awaitApproval` callback the transport owns.

```tsx
await approve('appr-123', { approved: true })
// or deny, with a reason surfaced to the model:
await approve('appr-123', { approved: false, reason: 'not allowed on this path' })
```

`approve` on the in-process transport rejects for an unknown/settled id (fail-fast — never a silent resolve).

## Per-request context / auth (M43)

Attach per-request context — an auth token, a tenant id, a provider selection — once, and it reaches
EVERY transport uniformly. Pass `context` (a value or a resolver, evaluated on every send/reconnect so a
rotating token is never stale):

```tsx
const { messages, send } = useAgent('chat', {
  context: () => ({
    headers: { Authorization: `Bearer ${useToken()}` }, // → HTTP request headers (HttpTransport)
    metadata: { tenant: 'acme', provider: 'openrouter' }, // → the in-process runner / Tauri invoke
  }),
})
```

Each transport maps context to its native mechanism:

- **`HttpTransport`** — `context.headers` become request headers (an app's HTTP context travels as
  headers). `metadata` is not used by HTTP.
- **`InProcessTransport`** — `context.metadata` is forwarded to the runner as `InProcessRunInput.context`
  (the sidecar/TUI runner reads it — e.g. to pick a provider).
- **`ChannelTransport`** — `context.metadata` is forwarded to the injected `start(turn)` as `turn.context`
  (the Tauri `invoke` passes it to the sidecar).

Context stops at the transport boundary — it never enters the agent runtime (the SDK already takes its
own per-run config). Calls WITHOUT `context` behave exactly as before.

## Reconnect (web, M37)

If a web stream drops, `reconnect()` resumes it via the durable transport (`GET /runs/<runId>/stream`).
The transport captured the run id from the initial response; a completed/evicted run returns `null`
and `reconnect()` is a no-op. (Auto-reconnect-on-drop and `Last-Event-ID` tail-resume land with M42.)

## Advanced: the transport as a building block

`HttpTransport` / `InProcessTransport` are plain `ChatTransport`s and the store, `AgentClient`, is
framework-agnostic — a standalone (no-React) client can subscribe to it directly (M44). You can also
implement your own `ChatTransport` (e.g. a WebSocket or a Tauri channel — M42) and pass it to `useAgent`;
the hook does not care how the bytes arrive, only that they are `UIMessageChunk`s.

## Why adopt `ChatTransport` (not a bespoke interface)

`ChatTransport` is the AI SDK's SOTA transport-agnostic chat seam, already a dependency. Adopting it
means the unified client, reconnect, per-request context (`headers`/`body`/`metadata`), and a standalone
client-SDK all fall out of one interface — reuse, not reinvention. See ADR-0050.
