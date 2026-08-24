---
'@theokit/agents': minor
'theokit': minor
---

A run whose connection drops mid-answer is reported as interrupted instead of finished. The agent
client used to settle a dropped stream in `status: 'done'` with `error` undefined and half a sentence
on screen — the spinner stopped, the error surface stayed empty, and the truncated turn was committed
to the thread as a completed one. `reconnect()` and the durable replay route were fully built and
unreachable, because the only trigger a consumer has for them is a status that never arrived.

`consumeChunkStream` (and `consumeUIMessageStream`) now return a `ChunkStreamOutcome` saying whether
the stream carried its terminal `finish` chunk and how many chunks crossed. When it did not,
`AgentClient` settles `status: 'error'` with an `AgentStreamInterruptedError` — a `TheokitAgentError`
with `code: 'AGENT_STREAM_INTERRUPTED'` and `isRetryable: true`, so `isTransientError` sees it and a
consumer decides on the type instead of on message text. The text already received stays on screen,
and `send()`'s existing rule keeps the truncated turn out of history.

The status is `'error'` rather than a new `'interrupted'` member on purpose: a new member fixes the
lie only for consumers who update their switch, while every other surface keeps rendering a finished
turn. Reusing `'error'` fixes it for all of them at once, and the reason for it lives in the typed
error where this framework already puts error discrimination.

This is a different axis from `stopReason` (#379), not another member of it. `stopReason` says why the
RUN stopped and rides the terminal frame's metadata; an interruption is the absence of that frame,
where the client cannot know why the run stopped because it never heard.

A stream that ends on its terminal `finish` chunk is unchanged, down to the fields on the snapshot.
A custom transport that never emitted `finish` — which no framework producer does, since
`presentUIMessageStream` emits it on every path including the error one — will now be reported as
interrupted, which is what it always was.
