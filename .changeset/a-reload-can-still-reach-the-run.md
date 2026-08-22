---
'@theokit/agents': minor
---

A run the server still holds can be reached after a page reload.

The whole durable-reconnect machinery — sequence ids on every frame, the `RunEventCache`, the
`Last-Event-ID` replay, the `x-theokit-run-id` header — was built and reachable, and one link made
it unusable in the case with the highest user cost. The reconnect key lived in a private in-memory
field, so a reloaded page built a fresh transport with an empty cell and `reconnectToStream`
returned `null` before it reached the network. The run was alive, cached, replayable, and
unreachable; the user got an empty thread instead of the answer the server had already finished.

`HttpTransport` takes a `runIdStore` now — `{ get(): string | undefined; set(id): void }` —
defaulting to an in-memory cell, which is exactly what the private field was. Nothing changes for a
caller who passes nothing, including the reconnect-within-one-page-lifetime case that already
worked.

The MEDIUM is deliberately the consumer's decision. `sessionStorage` matches a run's lifetime better
than `localStorage`, and either would be a client library writing to browser storage nobody asked it
to write to, with privacy and SSR consequences. So the seam is injected and the package stores
nothing it was not handed a place for.

Deliberately NOT included: reconnecting automatically on load. This makes a cached run *reachable*;
reaching for it is a product decision nobody has asked for.
