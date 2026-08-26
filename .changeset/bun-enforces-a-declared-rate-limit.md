---
'theokit': minor
---

`theokit build --target bun` now enforces a declared `rateLimit` instead of refusing the build. The limit is keyed on the caller's address as Bun reports it, so each visitor gets their own bucket. The other five Web-standards targets still refuse by name: they run per-invocation, where an in-process counter does not survive between requests, and a limiter that forgets is a limit that does not limit. A `keyBy` function, `keyBy: 'session' | 'user'`, and per-route limits are refused by name on `bun` too, rather than silently dropped.
