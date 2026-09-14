---
"@theokit/agents": minor
---

`withPreCompaction` runs your work — and awaits it — before a transcript is rewritten.

Until now the only signal near compaction was `compact_boundary`, which fires **after** the rewrite
and returns `void`. A consumer wanting to persist state that compaction destroys had nowhere to put
it, and the workaround was to build a policy on a turn hook and hope the ordering held.

```ts
import { withPreCompaction } from '@theokit/agents'

const guarded = withPreCompaction(runner.compaction!, async (messages) => {
  await archive(messages)          // the PRE-compaction transcript, still whole
})

await guarded.compact(transcript, { summarize })
```

It is a decorator over `TranscriptCompactionStrategy`, so the result satisfies the same interface
and every existing consumer accepts it unchanged. Registration is once per strategy rather than per
call — a handler you have to remember to pass is a handler that is absent from the call site you
forgot.

**What it does not cover, stated here rather than discovered later.** The SDK's auto-compaction path
— the one that fires on its own when usage crosses a threshold — has no consumer callback and none
can be added from this layer. A handler registered here never runs on that path. Tracked upstream as
`usetheokit/theokit-sdk#653`; the limit is also stated in the docblock where hook events are
declared, so it is visible from the file you would be reading when the question occurs to you.

**Failure is reported, never fatal.** A handler that rejects, throws synchronously, or exceeds its
bound (30s by default, configurable) is passed to your `onError` as a typed
`PreCompactionHandlerError` carrying `reason: 'timeout' | 'threw'` — and compaction proceeds anyway.
A run that cannot compact meets the context wall, which is worse than a run whose handler failed.

The handler also receives an `AbortSignal` that fires when the bound is reached, so a cooperative
handler can drop work that is now pointless instead of running on, detached, after compaction stopped
waiting for it. Signalling is not stopping — the timeout is what releases compaction either way.

The handler receives a readonly copy: `compact` documents that it never mutates its input, and a
seam that handed out the live array would open a mutation path through that guarantee.
