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

Peers (`@theokit/sdk` and `zod`) are optional. What each entry needs:

- `@theokit/presenter` (root): neither at runtime.
- `@theokit/presenter/wire`: `zod`.
- The `.d.ts` files reference types from both packages, so a TypeScript consumer without them needs `skipLibCheck` (or installs them as devDependencies).

New root exports must stay free of runtime imports of either peer; `tests/root-entry-has-no-runtime-peers.test.ts` pins it.

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

`fromSdkMessage` reads a failed, vetoed or timed-out tool call from the result's `exitCode` (non-zero),
not from `status`, because the SDK reports every finished call as `completed`. An absent or non-numeric
exit code is not a failure.

`fromRunTimelineEvent` is the door for `run.events()`, the SDK's one ordered timeline of messages and
token deltas. It drops text a message repeats (`textAlreadyStreamed`), repeated reasoning and repeated
tool lifecycle points, and holds a tool result until the other report can mark it failed. Keep one
state per run and flush it when the timeline ends:

```typescript
import { createRunTimelineState, flushRunTimeline, fromRunTimelineEvent } from '@theokit/presenter'

const state = createRunTimelineState()
for await (const item of run.events()) {
  for (const event of fromRunTimelineEvent(item, state)) render(event)
}
for (const event of flushRunTimeline(state)) render(event)
```

`fromWireChunk` is the other door — from the transport wire into the canonical event, which is what
a client-side surface receives. `createWireReader()` wraps it with the state a stream needs: it keeps
the call-name map and attaches the `data-error-code` code (`WIRE_ERROR_CODE_PART`) to the next `error` event. `fromInteractionUpdate` covers interactive runs.

A `Presenter<TOut>` is `surface` + `present(event)`, with optional `start()` / `finish()` framing for
stateful surfaces. `UIMessageStreamPresenter` holds open-block state and is therefore instantiated
**per stream**; `TerminalPresenter` and `JsonPresenter` are stateless and may be singletons.
`PresenterRegistry` resolves one by surface key and throws a typed `UnknownPresenterError` when the
key is unknown — never a silent fallback.

`foldTurnLifecycle` collapses a turn's events into a `TurnLifecycle` when a surface wants the
outcome rather than the stream.

Pass `{ messageBoundary: 'tool-call' }` as the third argument to split a preamble from the answer:
text seen before a tool call is emitted as its own completed message item (`message_0`,
`message_1`, ...) when the call arrives, and only the remainder is emitted at `finish`. The default,
`'none'`, keeps one concatenated `message` item. A `tool-result` chunk with `isError: true` reaches
`itemCompleted` with `isError: true`.

`contentChunkFromEvent(event)` turns an `AgentOutputEvent` into the `ContentChunk` the fold reads,
or `null` for events it does not model (reasoning, partial tool calls, status, finish).
`finalMessageOf(events)` returns the trimmed text after the last tool call, or all the text when
the turn made no tool call.

## Tool kinds

`TOOL_KINDS` is one table of known tool names. Each entry has a `kind` (`shell`, `diff`, `read`, `write`, `list`, `search`, `fetch`, `plan`, `memory`, `other`) and the input `targetKeys` that name the call's target, in preference order. `toolKindOf(name)` looks a name up.

```ts
import { toolKindOf } from '@theokit/presenter'

toolKindOf('shell') // { kind: 'shell', targetKeys: ['command', 'cmd'] }
toolKindOf('execute_sql') // undefined
```

Lookup is exact by design. A name that is not in the table gives `undefined`, never a substring guess, so `thread_summary` is not a read tool and `execute_sql` is not a shell tool. The table includes the SDK's builtin tools, pinned to the SDK type at compile time.

## Reading a tool result

`readToolResult(raw)` turns any tool result into one `ToolResultView` (`shell`, `diff`, `error` or `text`) and never throws. It accepts both shell dialects:

- `@theokit/sdk-tools` `shell_exec`: a JSON string `{ok, stdout, stderr, exit_code}`.
- The SDK runtime: an object `{stdout, stderr, exitCode}`.

When both exit-code spellings are present and differ, `exitCode` wins. A missing exit code stays `undefined`, never 0. `{ok: false, error}` reads as `error` (`tool_failed` when absent, `stderr` as `detail`); `{ok: true, diff}` and a raw unified diff string read as `diff`; anything else is `text`.

## Rendering a transcript

`foldTranscript(state, event)` folds `AgentOutputEvent`s into a `TranscriptState { items, status, error? }`, starting from `EMPTY_TRANSCRIPT`. Items are messages, reasoning, tool cards (`pending`, `running`, `success` or `failed`, with a `ToolResultView` from `readToolResult`) and an error. Text before and after a tool call are two message items; tool cards are keyed by `callId`. It is pure, never mutates its input, and returns the same state object when an event changes nothing (`status` events).

It is terminal-final: `finish` sets `done` and `error` sets `error` (keeping `code`); both fail every tool still `pending` or `running`, and every later event returns the same state.

Use `foldTranscript` to draw a chat screen. Use `foldTurnLifecycle` when you need the turn's lifecycle (items started and completed, the outcome) rather than a render state.

## Pending approvals

`pendingApprovals(messages)` returns every outstanding approval across wire messages, in order, as `PendingApproval { approvalId, toolCallId, toolName, input, question?, timeoutMs? }`. With nothing outstanding it returns one shared empty array. `readPendingApproval(part)` reads a single part. A part in `approval-requested` without a string `approval.id` is skipped, never settled by its `toolCallId`, because `approve()` could not settle it.

## Turn metadata

`readTurnMetadata(chunk)` (from `@theokit/presenter/wire`) reads a `finish` chunk's `messageMetadata` as a `WireTurnMetadata { usage?, cost?, durationMs?, stopReason?, model? }`. Fields of the wrong type are dropped rather than thrown on, and an unknown `stopReason` is dropped. It returns `undefined` for any other chunk or a finish without object metadata. A `stopReason` of `'step_limit'` or `'no_progress'` means the turn was cut, not finished.

## Refused tool calls

`AgentToolResultEvent.refusal?: ToolRefusal` (`{ by: 'human' | 'timeout' | 'policy' | 'hook' | 'plugin', reason? }`) marks a result as refused rather than run. `UIMessageStreamPresenter` sends it as a transient `data-tool-refusal` part (`WIRE_TOOL_REFUSAL_PART`, from `./wire`) just before the `tool-output-error`, and `readMessageStream` sets `refusal` on that tool part. The text the model reads does not change.

## Subpaths

| Subpath | What lives there |
|---|---|
| `.` | The event, the `Presenter` contract, the registry, the sources, the three presenters |
| `./wire` | The wire-format types shared with transports |
| `./diff` | The one unified-diff model for UI kits: `parseUnifiedDiff`, `foldDiffLines`, `segmentWords`, `pairIntraLines`, `DiffParseError`. Data only; the only entry that loads `parse-diff` and `diff` |

## Licence

Apache-2.0 — see `LICENSE`.
