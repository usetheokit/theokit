---
'theokit': minor
---

The deploy shim delivers bytes as the handler produces them, instead of collecting the whole
response and handing it over at the end.

`createWebShim`'s `res.write()` now enqueues into a `ReadableStream` that the `Response` already
carries, and `toResponse()` settles the moment status and headers are known — at `writeHead()`, or
at the first `write()`/`end()` when the caller never called `writeHead()`. It used to settle only
inside `end()`, from a single concatenation of every chunk, so no byte was observable before the
handler returned. Measured through the shim, a run emitting a chunk every 120 ms arrived as one
chunk at the millisecond the run ended; on the served Node path the same run arrived as eight.

Fixing the shim alone would not have reached the wire. Every emitted handler awaited `executeRoute()`
before asking for the Response, which re-buffered the whole body in the handler — a second buffering
point, one per target. All six now pass the in-flight run into `toResponse(executeRoute({ … }))`.
The Vercel function additionally drained the Response into a string; it now writes chunk by chunk
into the Node response and its `.vc-config.json` declares `supportsResponseStreaming`, without which
the platform buffers regardless of how the handler writes.

Three contract points the caller has to know about:

- **Headers freeze at the first byte.** `setHeader()`/`writeHead()` after the Response has been
  handed out now throw, naming the header, the way Node's own `ServerResponse` raises
  `ERR_HTTP_HEADERS_SENT`. They cannot be honoured once bytes are moving, and silently dropping them
  is a lie the caller never sees.
- **Backpressure is reported.** `write()` returns `false` once the outbound queue passes 64 KiB and
  `once('drain', cb)` fires when the consumer makes room; the framework's own stream writer honours
  both, so a slow consumer no longer lets the queue grow without bound.
- **A failure after the first byte cannot become a status code.** `toResponse(pending)` rejects when
  the run fails before the headers are out, and errors the body stream when it fails after — so the
  consumer sees a broken stream rather than a short body that looks complete.

`aws-lambda` is delisted for response streaming rather than fixed. Its v2 result object carries the
body as a string, so nothing can leave the function before the run ends; streaming would need
`awslambda.streamifyResponse` and a Function URL in `RESPONSE_STREAM` invoke mode, which this adapter
does not emit and which would break every API Gateway deployment of it. The build now refuses by name
when `ssrStreaming` is on, and the emitted handler logs the route by name when it buffers a
`text/event-stream` response. `DeployAdapter` gained `streamsResponses` so every target states its
answer instead of being listed for something nobody exercised.
