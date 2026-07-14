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

## Expose an agent, visibly — `@Expose` + typed handle (M47)

By default an agent is served by convention (`agents/chat.ts` → `POST /api/agents/chat`) and bound by name
(`useAgent('chat')`). When you want the exposure **visible in one code review** — the route, CSRF, and auth
next to your other controllers — bind the (separately-built) agent with `@Expose`:

```ts
// agents/chat.ts — the pure agent (behavior only)
export default agent().input(z.object({ message: z.string() })).model('openai/gpt-4o-mini').tool(weatherTool).build()

// server/controllers/agents.controller.ts — the EXPOSURE, visible
import { Controller, Expose, UseGuards } from '@theokit/http'
import chatAgent from '../../agents/chat'

@Controller('api/agents')
export class AgentsController {
  @Expose(chatAgent, { csrf: true }) // → POST /api/agents/chat, streams the agent's UIMessageStream
  @UseGuards(RequireSession)          // auth is visible, not hidden in config
  chat!: typeof chatAgent
}
```

On the frontend, bind by the generated **typed handle** — no magic string, no duplicated input type
(cmd-click `chat` → `agents/chat.ts`; `send` is inferred from the agent's `.input()`):

```tsx
import { chat } from '@theo/agents' // generated handle: { path } + phantom input/tool types
const { thread, send } = useAgent(chat)
```

The **same handle** drives every surface:

```tsx
useAgent(chat)                                  // web    — HttpTransport to chat.path
useAgent(chat.inProcess(run))                   // TUI    — InProcessTransport
createAgentClient(chat.channel(source))         // desktop — ChannelTransport
```

One runtime under it all (`mountAgent`): `@Expose`, `@Agent`, and the file convention are **authoring
surfaces, not competing paths**. `@Expose` is opt-in — the zero-config convention still works unchanged.

## One conversation, every surface — `thread` (M46)

`useAgent` returns two views of the messages:

- **`messages`** — the CURRENT turn's assistant messages, reset on every `send`. Back-compat since M41.
- **`thread`** — the WHOLE conversation to render: committed turns + the current user message + the
  in-flight streaming assistant, accumulated across sends with stable ids, committed exactly once, cleared
  only by `reset()`.

Render `thread` — don't hand-roll a transcript from `messages`. The client store (the React-free
`theokit/client/core`) owns the accumulation and id management, so the SAME conversation drives web,
desktop (Tauri) and TUI with identical shape:

```tsx
function Chat() {
  const { thread, status, send } = useAgent('chat')
  return (
    <>
      {thread.map((m) => (
        <Message key={m.id} message={m} />
      ))}
      <button onClick={() => send({ message: 'hi' })}>Ask</button>
    </>
  )
}
```

Before M46, each surface re-implemented ~88 lines of transcript state (local history + a commit-once
effect + an in-flight merge with fabricated ids). That is now one field on the store — an errored or
aborted turn is dropped rather than corrupting committed history, and stale (aborted) drives never append.
The no-React client exposes the same value at `createAgentClient(...).getState().thread`.

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

## Use an agent from a script — no React (M44)

`useAgent` is the React binding; for a node script, a CLI, a test, or a non-React UI, use
`createAgentClient` from the React-free entry `theokit/client/core` — the same store, no React in your
bundle:

```ts
import { createAgentClient, HttpTransport } from 'theokit/client/core'

const client = createAgentClient(new HttpTransport({ api: 'https://myapp.com/api/agents/chat' }))

// Ergonomic streaming: yield the assistant message as it streams; last value is the final result.
let final
for await (const message of client.stream({ message: 'summarize my inbox' })) {
  final = message
}
console.log(final?.parts)

// Or event-driven: subscribe + getState (+ send / abort / reset / approve / reconnect).
const unsub = client.subscribe(() => console.log(client.getState().status))
```

`createAgentClient` drives ANY transport (`HttpTransport` over node fetch, `InProcessTransport` in a
test, `ChannelTransport`), supports M43 `context`, and imports no React (`theokit/client/core` is a
React-free entry). `theokit/client` also re-exports `createAgentClient` for React apps' convenience.

## Advanced: the transport as a building block

`HttpTransport` / `InProcessTransport` are plain `ChatTransport`s and the store, `AgentClient`, is
framework-agnostic — a standalone (no-React) client can subscribe to it directly (M44). You can also
implement your own `ChatTransport` (e.g. a WebSocket or a Tauri channel — M42) and pass it to `useAgent`;
the hook does not care how the bytes arrive, only that they are `UIMessageChunk`s.

## Scaffold a surface — `create-theokit --surface` (M45)

The `create-theokit` scaffolder generates each surface wired to this unified client:

```bash
npx create-theokit my-app                    # web (default) — useAgent('/api/agents/chat')
npx create-theokit my-app --surface tui      # terminal (Ink) — useAgent(InProcessTransport)
npx create-theokit my-app --surface desktop  # desktop (Tauri) — createAgentClient(ChannelTransport)
```

- **`--surface tui`** — an Ink terminal app (`tui/App.tsx`) driving `useAgent(new InProcessTransport({
  run: (i) => streamAgentTurnInProcess(mod, apiKey, i) }))`. Runs in-process; no server, no port.
- **`--surface desktop`** — a Tauri app: a Node sidecar (`streamAgentTurnInProcess` → JSONL stdout), a
  Rust shell pushing lines over a `Channel`, and a vanilla-JS webview consuming via
  `createAgentClient(new ChannelTransport({ source }))` from the React-free `theokit/client/core`. The
  desktop build needs the Rust + Tauri toolchain.

Each scaffolded app is the same agent on the same client — write once, consume (and scaffold) on any surface.

## Why adopt `ChatTransport` (not a bespoke interface)

`ChatTransport` is the AI SDK's SOTA transport-agnostic chat seam, already a dependency. Adopting it
means the unified client, reconnect, per-request context (`headers`/`body`/`metadata`), and a standalone
client-SDK all fall out of one interface — reuse, not reinvention. See ADR-0050.
