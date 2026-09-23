---
'theokit': patch
---

A generated deploy entry now calls one limiter builder, and awaits it unconditionally.

`buildRateLimiter(config, store)` is new on `theokit/server/rate-limit`. It takes a store or nothing
and is always async, so the entry a build emits no longer changes shape with your config.

**Nothing you wrote changes.** `createRateLimiterWeb` and `createDurableRateLimiterWeb` keep their
signatures and their behaviour; this sits above them.

**What it fixes, for a deployment that declares a store.** The emitted entry used to decide, per
config, whether to `await` the limiter — because one of the two limiters returned a value and the
other a Promise. A call site whose shape depends on configuration is a call site that can be wrong
for one configuration and right for another, and that is the class of defect that shipped a limit
which never limited. There is no decision left to get wrong.

**A null store no longer refuses every caller.** Passing `null` where a store was expected used to
fall through to the durable path, throw inside it, and be caught by the unreachable-store handling —
so every request was refused with a header blaming the store, for what was an argument mistake.
`null` now takes the in-process limiter, which is what an absent store means.
