---
'@theokit/agents': major
---

The agent route `generateAgentRoutes` mounts now speaks the wire this framework's clients read.

There were TWO SSE encoders for agent runs and they did not agree. The durable one writes
`data: <UIMessageChunk>` and a terminal `data: [DONE]`; this one wrote
`event: <type>` + `data: <framework StreamEvent>` — snake_case agent events rather than kebab-case
wire chunks — and no terminator at all.

`parseWireStream` validates each `data:` payload against `wireChunkSchema` and drops what fails
through a `warn` whose default sink is a no-op. So a `TheoApp` app mounted with `agentRuntime`
served `POST {route}/chat` in a format none of its own clients could read: zero chunks, no
assistant message, and a run reporting success with an empty answer — silent at every layer.

The events go through `presentUIMessageStream` now, the same translator `mountAgent` uses, so there
is one wire and one place that produces it. It also terminates: the missing `finish` chunk is what
a client keys "completed" on, so without it a finished run and a dropped connection were
indistinguishable there too.

**Breaking** for anyone who built their own reader against the old framework-event format on this
route. That is the trade the fix makes: a wire only a bespoke consumer could read, for the one every
client in this framework already speaks.
