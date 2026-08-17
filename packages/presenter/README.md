# `@theokit/presenter`

The presentation layer: **one normalized agent-output event, N surfaces.**

Agent output has to reach a web stream, a terminal, and a JSON API. Translating the runtime's
messages separately for each of them gives you N×M translators that drift — the terminal grows a
tool-call rendering the web never gets, and a new SDK event lands in one path only.

This package is the narrow waist that removes the multiplication. Every **source** translates
*into* `AgentOutputEvent`; every **presenter** translates *out of* it.

```
SDK message ─┐                        ┌─→ UIMessageStreamPresenter → web
             ├─→ AgentOutputEvent ────┼─→ TerminalPresenter        → ANSI rows
wire chunk ──┘                        └─→ JsonPresenter            → records
```

The variants are derived from the runtime's own discriminants, never from one surface's wire
format — so no surface leaks into the contract.

## Install

```bash
pnpm add @theokit/presenter
```

Peers: `@theokit/sdk` and `zod`.

## The canonical event

Eight variants, discriminated on `type`:

| Variant | Carries |
|---|---|
| `text` | assistant text output, streamed or whole |
| `reasoning` | thinking content, distinct from user-visible text |
| `tool-call` | a tool invocation with its committed input |
| `partial-tool-call` | incremental tool input while the model streams the args |
| `tool-result` | the result for a `callId`, with `isError` for failures |
| `status` | run-level status |
| `error` | a failed turn |
| `finish` | the end of the turn plus its metadata |

## Sources and presenters

```typescript
import { fromSdkMessage, TerminalPresenter } from '@theokit/presenter'

const presenter = new TerminalPresenter()
for (const message of sdkMessages) {
  for (const event of fromSdkMessage(message)) {
    for (const row of presenter.present(event)) render(row)
  }
}
```

`fromWireChunk` is the other door — from the transport wire into the canonical event, which is what
a client-side surface receives. `fromInteractionUpdate` covers interactive runs.

A `Presenter<TOut>` is `surface` + `present(event)`, with optional `start()` / `finish()` framing for
stateful surfaces. `UIMessageStreamPresenter` holds open-block state and is therefore instantiated
**per stream**; `TerminalPresenter` and `JsonPresenter` are stateless and may be singletons.
`PresenterRegistry` resolves one by surface key and throws a typed `UnknownPresenterError` when the
key is unknown — never a silent fallback.

`foldTurnLifecycle` collapses a turn's events into a `TurnLifecycle` when a surface wants the
outcome rather than the stream.

## Subpaths

| Subpath | What lives there |
|---|---|
| `.` | The event, the `Presenter` contract, the registry, the sources, the three presenters |
| `./wire` | The wire-format types shared with transports |

## Licence

Apache-2.0 — see `LICENSE`.
