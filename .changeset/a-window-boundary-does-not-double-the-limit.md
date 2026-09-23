---
'theokit': minor
---

A rate limit is no longer doubled at its window boundary.

Measured before the fix: `windowMs: 400, max: 5` admitted **10 requests in ~405ms**. Both limiters were
fixed-window counters, so a caller that filled a window just before it expired and filled the next one
just after spent two budgets inside one window's worth of time.

**Both limiters, and that word is load-bearing.** `createRateLimiterWeb` and
`createDurableRateLimiterWeb` now read the same sliding count from the same function, so the guarantee
does not depend on which one your deployment uses.

`max` now means what it says: at most `max` in any `windowMs`.

**What changed in the contract, and why it is additive.** `RateLimitState` carries an optional
`previousCount` — how many requests the window before this one admitted. The limiter charges the
current window plus however much of the previous one has not yet slid out.

**A store you wrote yourself keeps working.** If your `RateLimitStore` returns only
`{ count, resetAt }`, nothing breaks: the limiter charges the current window only, which is exactly
the behaviour you have today, boundary burst included. To get the fix on your own store, return
`previousCount` from `incr` — the count of the window that just expired.

**Headers are unchanged.** `X-RateLimit-Remaining` still reports the current window, because it
answers "how many more may I send" and a weighted total is not a number of requests. What moved is the
threshold at which a request is refused.
