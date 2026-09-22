---
'theokit': minor
---

A rate limit can now be backed by a store that survives an invocation.

`createDurableRateLimiterWeb`, new on `theokit/server/rate-limit`, accepts any `RateLimitStore` and
awaits it — where the existing `createRateLimiterWeb` refuses anything but the in-memory default,
because its closure returns synchronously and cannot await. On a per-invocation runtime an in-process
counter does not survive between requests, so a limiter built on one forgets, and a limit that forgets
is a limit that does not limit.

**Your existing code is untouched.** `createRateLimiterWeb` keeps its signature, its guard and its
error. Nothing that works today changes; the durable path is reached by naming it.

**The framework still ships no store.** Bring a Redis client, a Cloudflare KV binding, or anything
else satisfying the `RateLimitStore` contract — a framework that shipped one would be choosing every
deployment's datastore. See `docs/adr/0018`.

**What you do NOT get yet:** a generated deploy entry does not consume this path. `theokit build`
still refuses a declared rate limit on Cloudflare, Deno Deploy, Netlify, Vercel and AWS Lambda, for
the reason it always has — the counter would not survive. Wiring the entry is the next step.
