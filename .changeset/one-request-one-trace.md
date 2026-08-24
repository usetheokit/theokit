---
'theokit': patch
---

A request with no inbound `traceparent` now produces ONE trace instead of two. The HTTP span and the
agent run each resolved the request's trace by reading the header independently, which agrees only
while a header is present — the common request (a browser, `curl`, an uninstrumented `fetch`) sent
none, so each side minted its own and the request reached the collector split in half. The trace is
now resolved once per request and shared, and the run hangs under the HTTP span rather than beside
it.
