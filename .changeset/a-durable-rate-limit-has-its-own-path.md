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

**A generated deploy entry uses it when your config names a store.** Cloudflare, Deno Deploy,
Netlify, Vercel and AWS Lambda build and enforce; without a store `theokit build` still refuses
them by name, for the reason it always has — the counter would not survive.

**Two refusals guard the config.** A `store.factory` that is not a plain identifier is rejected at
build time, because it is written into the generated entry as `import { <factory> }` where no escape
applies. And silencing the build's unapplied-config warning no longer switches off that refusal: the
two now read separate declarations.

**An unreachable store refuses the request rather than serving it**, with a header naming the store
so an outage does not read as every caller hitting their quota. See `docs/adr/0019`.
