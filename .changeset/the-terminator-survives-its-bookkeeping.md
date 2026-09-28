---
'theokit': patch
---

An agent stream on Cloudflare Workers terminates, so a client stops waiting after the reply arrives

Two defects, one visible symptom: every chunk of a turn arrived — `finish` included — and the request
then never ended. A browser rendered the reply and the turn never completed, because a client keys its
terminal state on the `[DONE]` frame.

**The trigger.** `RunEventCache.end()` called `buf.evictTimer.unref()` unconditionally. `unref` is
Node-only, and the result is the opposite of the intuition: probed with two workers differing only in one
line of `wrangler.toml`, workerd WITHOUT `compatibility_flags` returns a Timeout whose `unref` works, and
with `["nodejs_compat"]` — exactly what this framework's Cloudflare adapter emits — `setTimeout` returns a
NUMBER and the call throws `TypeError: buf.evictTimer.unref is not a function`. The Node-compat flag is
what removed the Node API. It is feature-detected now, so a runtime that has `unref` still gets it.

**What made a one-line trigger cost the whole stream.** `durableUiMessageStreamResponse`'s `finish()` set
its idempotence flag FIRST, then called `cache.end(runId)`, then enqueued the terminator and closed. The
throw skipped both terminal operations, `pull`'s own `catch { finish(controller) }` found the flag already
set and returned, and the flag that exists to prevent a SECOND terminator prevented the ONLY one. The
bookkeeping is isolated now and reported rather than swallowed: what its failure costs is a reconnect
replay that may be stale, which a reader of the log can act on, while a stream that never ends gives them
nothing. `cancel` had the same exposure, where it would have cost the release of the turn.

Measured end to end against a real turn on workerd: before, `curl --max-time 25` exited 28 with no
`[DONE]`; after, it exits 0 in 3.5s with the reply and the terminator. The regression test reproduces the
hang as a hang — the three cases time out at 30s without the fix.
