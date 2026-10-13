# 0025: An ACP tool call rejects a turn the agent stopped early

- Status: Accepted
- Date: 2026-10-09
- Deciders: the repository owner, through the loop-code-review audit of B-408 (plan `theo-acp-tool-handshake`)

## Context

An ACP agent answers `session/prompt` with a result whose one field is `stopReason`. ACP v1 defines
five values: `end_turn`, `max_tokens`, `max_turn_requests`, `refusal` and `cancelled`. The reply
text arrives before that result, as `session/update` notifications.

Up to this change the tool returned by `createACPTool` awaited `session/prompt`, dropped its result
and returned the streamed text. An agent that hit its token limit, ran out of model requests,
refused or cancelled its own turn therefore came back to the calling model as a finished answer,
with nothing to say that the work stopped halfway. The audit reproduced it with an agent that
streamed `I started refactoring the fi` and answered `{ stopReason: 'max_tokens' }`: the call
resolved with that fragment (loop-code-review LCR0103).

## Decision

The tool reads `stopReason` from the `session/prompt` result:

| Result | Outcome of the call |
| --- | --- |
| `{ stopReason: 'end_turn' }` | resolves with the streamed text, as before |
| `max_tokens`, `max_turn_requests`, `refusal`, `cancelled` | rejects with `AcpTurnStoppedError` |
| any other string | rejects with `AcpTurnStoppedError`, described as a stop reason the client does not know |
| no string `stopReason` (`{}`, `null`, a number) | rejects with an `Error` naming `session/prompt` and the result it got, the same shape as a `session/new` with no `sessionId` |

`AcpTurnStoppedError` is a new export of `theokit/server/agent`. It carries `command`, `stopReason`
and `partialText`, the text the agent streamed for its session before it stopped. Its message names
the reason and what it means, so a model that sees only the message can tell a truncated turn from
a finished one.

The tool never sends `session/cancel`. A run cancelled through its `signal` still rejects with the
signal's reason and closes the agent, so `cancelled` here always means the agent ended the turn on
its own.

## Considered options

1. **Reject every reason but `end_turn`, keeping the partial text on the error** (chosen). The
   caller cannot mistake half an edit for the result, and the text is not lost.
2. **Resolve with the partial text plus a marker in the string.** Rejected: the tool returns a
   string, so the marker would be prose the model may skip, and a program calling the handler
   would have to parse it.
3. **Treat `refusal` and `cancelled` as errors and resolve on `max_tokens` and
   `max_turn_requests`.** Rejected: a turn cut by a limit is as unfinished as a refused one, and a
   caller that wants the fragment reads `partialText`.
4. **Resolve on an unknown string.** Rejected: an unknown reason is not known to be a finished turn,
   and failing closed is the direction a caller can recover from.

## Who is affected

Searched `packages/` and `apps/` for `createACPTool` on 2026-10-09. Outside its own module, the
`theokit/server/agent` barrel, doc comments and tests, nothing in this repository calls it, so the
affected callers are external users of `theokit`. A call against an agent that ends with
`end_turn` behaves exactly as before. A call whose agent stops early now rejects where it used to
resolve, and a caller that relied on the fragment reads it from `partialText`.
