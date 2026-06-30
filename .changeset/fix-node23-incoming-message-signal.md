---
"theokit": patch
---

Fix `defineAgentEndpoint` returning an empty (0-byte) SSE stream for every prompt on Node ≥ 23.

Node 23 added `http.IncomingMessage.prototype.signal` — an `AbortSignal` that fires `abort` the instant the request body is fully received (`req.complete === true`), NOT when the client disconnects. `resolveAbortSignal` duck-typed a Web `Request` as "has `.signal` with `aborted` + `addEventListener`"; on Node 24 the Node `IncomingMessage` also satisfies that shape, so the wrapper returned the request-lifecycle signal — already aborted by the time the handler primes — and closed the stream before the first `yield`. Every agent response (chat, tool calls) came back empty on Node 24.

The fix discriminates a Node `IncomingMessage` (an `EventEmitter`, `typeof r.on === 'function'`) from a Web `Request` (no `.on`): `r.signal` is trusted directly only when the request is not a Node object. For the Node path, client-disconnect is wired to the underlying socket close (`req.socket.on('close')` — the only event that means "client gone", never fires at request-body-end), with `req`'s own `'close'` guarded by `complete` to ignore Node ≥ 23 body-end noise. Regression covered by `tests/unit/regression-2-define-agent-endpoint-node23-signal.test.ts`.
