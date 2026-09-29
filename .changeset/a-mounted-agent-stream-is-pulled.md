---
'@theokit/agents': patch
---

The stream a mounted agent answers with is pulled, not pushed

`streamAgentResponse` built its body with `new ReadableStream({ async start })`. That runs eagerly and
leaves a floating promise: Node drains the microtask queue after the handler returns, and workerd tears
down pending work — so the continuation after an `await` is not guaranteed to run, and the two
operations at the end of the loop are the terminal `[DONE]` frame and `controller.close()`. A client
keys its terminal state on that frame.

The same rewrite landed in `server/agent/durable-ui-message-stream-response.ts` for a teardown measured
on a deployed worker, and did not reach this encoder — so the pattern survived one module away from its
own fix. `pull` is demand-driven, behaves identically across Node, workerd, Deno and Bun, and brings
backpressure — one frame per pull rather than a whole turn buffered in the controller — and
cancellation, which the eager shape could not express at all.

`cancel` receives a reason, and it is neither forwarded nor dropped. It cannot be forwarded: the chunk
generator's `TReturn` is `void`, so `return()` accepts nothing else, and a cast would be a lie about
the type — the sibling encoder appears to forward one only because it holds a loosely typed
`AsyncIterable`, where the value reaches nobody either. It is recorded on the `THEOKIT_DEBUG` channel
instead, because a turn released before it finished is a fact an operator wants, while a client
navigating away is normal and must not write to stdout by default.

The guard is an assertion on the declaration, because the behavioural one cannot be written in-process
and was tried first: "nothing is consumed before the body is read" PASSES with the defect in place.
`async start` is invoked during construction and runs synchronously only to its first suspension, and
that suspension is the first `.next()` of the chunk generator, which yields its opening chunk before
touching the source. A test that passes before the fix guards nothing.
