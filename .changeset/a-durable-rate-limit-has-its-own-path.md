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

**Four refusals guard the config**, all at build time, because the generated entry is where a bad
value becomes a deploy that does not parse.

- `store.factory` must be a plain identifier AND a bindable one. It is written as
  `import { <factory> }`, where no escape applies and `import { default }` is a SyntaxError — so
  `factory: 'default'`, which `export default createStore` invites, is refused by name rather than
  emitted. `defaultStore` stays legal.
- `store.options` must be strings, numbers and booleans. A function was previously accepted and then
  silently dropped by `JSON.stringify`, so the store was constructed without an option nobody was
  told about.
- `store.module` must be a specifier.
- Silencing the build's unapplied-config warning no longer switches off the refusal: the two read
  separate declarations.

**A store declared for deploy no longer stops `theokit start`.** The same `store` key carries a
build-time declaration and, programmatically, a live store object; the dev server received the first
and refused to boot citing async middleware. It now tells them apart and keeps limiting in process,
which is why `node` and `bun` enforce without a store at all.

**A store outage is visible to an operator, not only to the caller.** The 503 already named the
store; the failure's cause now reaches `console.warn`, so a timeout, an auth failure and a DNS error
stop looking identical during the incident that caused them.

**An unreachable store refuses the request rather than serving it**, with a header naming the store
so an outage does not read as every caller hitting their quota. See `docs/adr/0019`.
