---
'theokit': patch
---

Both rate limiters now answer with the same header names.

`createRateLimiterWeb` emits `X-RateLimit-Reset` alongside `-Limit`, `-Remaining` and `Retry-After`,
which is what `createDurableRateLimiterWeb` already emitted.

**What this fixes for you.** A client reading `X-RateLimit-Reset` worked against a deployment backed
by a durable store and not against `theokit start` — so the header contract depended on which runtime
you had picked, which is not something a client can know. It now reads the same names either way.

The VALUES still differ between the two, deliberately: one counts in your process and the other in
your store, so identical numbers would be wrong the moment two instances disagree — which is the case
the durable limiter exists for. What is now identical is the set of names.
