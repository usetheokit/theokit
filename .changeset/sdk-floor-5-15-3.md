---
'@theokit/agents': patch
'theokit': patch
'create-theokit': patch
---

The `@theokit/sdk` floor is now 5.15.3, in `@theokit/agents`, `theokit` and the `create-theokit` template. 5.15.3 bounds the wait for a model response's headers (30 s by default), so a request whose response never starts fails with a retryable `NetworkError` and is retried, instead of holding the turn for up to 300 s.
