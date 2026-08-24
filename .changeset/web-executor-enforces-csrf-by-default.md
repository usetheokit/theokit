---
'theokit': minor
---

`executeWebRequest` enforces CSRF unless you turn it off.

**Breaking**, for anyone calling `executeWebRequest` from `theokit/server/http` directly. Routes
served by `theo dev` or `theo start` go through `executeRoute`, whose CSRF gate has defaulted to
strict all along, and are unaffected.

`ExecuteWebRequestOptions.csrfMode` had no default. Both of the executor's gates compared the value
against `'strict'`, so omitting the option meant no CSRF check ran on `POST`, `PUT`, `PATCH` or
`DELETE`. Omitting it now enforces, and `'off'` is the only value that disables the gate.

```diff
- // no csrfMode → no CSRF check
- await executeWebRequest(request, routeModule)
+ // no csrfMode → gate enforced
+ await executeWebRequest(request, routeModule)
+
+ // opt out explicitly, only if you have another defense
+ await executeWebRequest(request, routeModule, { csrfMode: 'off' })
```

A route that legitimately receives third-party POSTs — a Stripe or GitHub webhook, an OAuth
callback — declares `csrf: false` on its own config, which the Web executor now honours and
previously ignored. Browsers using the generated action client need no change: it already sends
`X-Theo-Action: 1`.

The option existed, the safe value existed, and the default was the unsafe one, so the check ran
only for a caller who already knew to ask — and this executor is the boundary the Cloudflare, Bun
and Deno adapters are built on, each of them a caller that would have had to remember. Honest size
of it: there is no production caller of the unsafe default in this repository today, so this closes
a future boundary rather than a live exposure.
