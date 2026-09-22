---
'theokit': minor
---

Every deploy target's generated entry now resolves the caller's address from a source its own
runtime controls, or refuses that request by name — and a WebSocket upgrade no longer walks past
the limit (B-027).

**`minor` rather than `patch`** because `theokit/server/rate-limit` publishes API it did not have:
`resolveClientIpFromRequest`, which the generated entries import.

## What each entry reads

| target | address source |
|---|---|
| `cloudflare` | `cf-connecting-ip` — written by the runtime, unforgeable through the edge |
| `vercel` | the `Request` it already builds |
| `netlify` | its handler `context` |
| `deno-deploy` | the `Deno.serve` info it was always handed and discarded |
| `aws-lambda` | its event's `sourceIp` |
| `bun` | `server.requestIP(request)` — the peer address, no proxy header involved |

Where none resolves, the entry answers **503 naming the target** rather than sharing one bucket.
`security.rateLimit.trustProxy` reaches the generated entry for the first time, so a forwarded
header is read only where the deployment says a proxy writes it.

## The upgrade no longer skips the limiter

On `cloudflare` and `deno-deploy` the WebSocket upgrade was answered **above** the rate-limit
check, so the cheapest way past a declared budget was to ask for the most expensive thing the entry
hands out — a long-lived socket. The branch now sits below the check.

The comment that justified the old order is the reasoning error worth naming: *a 101 carries no
document and no script, so the security baseline does not apply to it*. True of the security
**headers**, a document concern. False of the limiter, a resource concern. One sentence was
carrying both claims.

## Exercised, not asserted

Each emitted handler is loaded and **driven**: six targets, three calling conventions, three
response shapes, two requests against a `max: 1` budget and one with no address anywhere.

The upgrade fix was proved by mutation — reverting it failed **exactly 2 of 30** cases and left 28
green, and the restoration was verified byte-identical rather than by an exit code. All-fail would
have meant it did not compile; all-pass, that it never applied.

Measured cost on the path this puts in front of every request: **about 0.9 µs**, and the address
resolution is the larger half at roughly 4× the limiter it feeds.

## What a consumer does NOT get yet

`theo build` still **exits 1** for a declared `security.rateLimit` on `cloudflare`, `vercel`,
`netlify`, `deno-deploy` and `aws-lambda`: the counter does not survive between invocations there,
and a limit that forgets is a limit that does not limit (B-257). The refusal names the target and
says the config *"reads as protection the deploy will not have"*.

`bun` is the one target that both resolves and enforces — for **one process**. Two processes hold
two counters, and `BakeableRateLimit` carries no `store`, so the distributed adapter that
`rate-limit-store.ts` documents cannot be declared from a generated entry.
