# 0019 — An unreachable rate-limit store answers 503, and says which

- **Status:** accepted
- **Date:** 2026-09-22
- **Deciders:** taken under `rules/autonomy-envelope.md` § *A structural decision the contract wants recorded*, as T3.1 of B-257
- **Follows:** [ADR 0018](0018-a-durable-rate-limit-gets-its-own-path-beside-the-sync-facade.md), which built the durable path but deliberately left this open

## Context

`createDurableRateLimiterWeb` awaits a store the application brought. That store is a network
dependency — Redis, a KV binding, an HTTP-backed counter — and a network dependency fails.

ADR 0018 built the path and listed this as unresolved, in those words: *"fail open and the limit is
not a limit; fail closed and a store outage is an app outage. Both are defensible and neither is
written down."* Leaving it there means whoever implements it decides by accident, in a `catch` nobody
reviewed.

## Decision

**A request whose store could not be reached is answered 503, and the answer names the store as the
cause.** The limiter does not swallow the rejection and does not admit the request.

Three halves:

1. **It fails CLOSED.** A request that could not be counted is not served.
2. **It answers 503 and not 500.** The service is unavailable, not broken: the deployment is correct
   and a dependency is down, which is what 503 means and what `Retry-After` is for.
3. **The rejection is not swallowed.** A `catch` that returns `{ limited: false }` is the swallowed
   error `rules/error-handling.md` § 5 lists first among its anti-patterns, and the failure would be
   invisible exactly while the limit is not limiting.

## Why fail closed — and it is the repository's own precedent, not a preference

The analogous question was already decided one item ago, for the same subsystem, and the answer is
emitted in every entry B-027 produced. When a runtime **cannot name the caller**, the generated entry
answers **503** rather than keying every visitor on a constant —
`packages/theo/src/adapters/deployed-rate-limit.ts:315` states the reason: *"one shared bucket is a
budget the first caller each window exhausts"*, and `:323-329` emits the `unnamedCaller()` helper
that returns it.

The shape is identical. **A limiter that cannot identify a caller and a limiter that cannot count one
are both a limiter that is not limiting**, and this repository already decided that such a request is
refused rather than served blind. Deciding the opposite here would mean one deployment answering 503
because the address was unresolvable and 200 because the counter was unreachable, with no argument
for the difference.

## Who is affected

| Consumer | Effect |
|---|---|
| an app declaring `rateLimit` with NO store | **none.** The sync facade is untouched (ADR 0018) and has no store to fail |
| an app declaring a store, while it is healthy | **none.** This path runs only on rejection |
| an app declaring a store, during an outage of it | requests are refused 503 with `Retry-After`, where an unconsidered implementation would have served them unlimited |
| the six generated entries | they already emit a 503 helper for the unnamed-caller case; this reuses that shape rather than adding a second one |

## What would break, and what would not

**Nothing that works today.** The path is new surface (ADR 0018) with no callers until an application
names a store.

**The cost, stated plainly:** an outage of the store becomes an outage of the routes that declare a
limit. That is the price of the decision and it is real. It is accepted because the alternative is
worse in the direction that cannot be observed — a limit silently not limiting, during exactly the
incident when something is hammering the endpoint, is indistinguishable from a limit working.

## Alternatives rejected

**A — fail open.** Serve the request and log. Rejected: `rateLimit` is, in this codebase's own words
(`adapters/config-support.ts:213-215`), *"the one whose absence looks exactly like success"*. Failing
open makes the absence invisible at the moment it matters most, and the deployment cannot tell a
healthy limiter from a dead one by observing traffic.

**B — fall back to an in-process counter.** Rejected: on a per-invocation runtime that counter is
fresh every invocation, so the fallback IS failing open, wearing a name that suggests otherwise. It
would also re-introduce the exact defect B-257 exists to remove.

**C — retry with backoff before deciding.** Rejected as premature, not as wrong. A retry inside a
request's critical path spends the caller's latency budget on a dependency that is already failing,
and the value depends on the store's failure shape — which this repository has not measured for any
store, because it ships none. An application that knows its store can wrap it: the contract takes any
`RateLimitStore`, and a retrying one is a valid implementation.

## Consequences

- `createDurableRateLimiterWeb` catches the rejection, marks the result `limited` and carries a
  `Retry-After`, so a caller and an operator can both tell what happened.
- The result shape does not change, so no generated entry needs a new branch for it.
- **This is the framework's floor, not a deployment's policy.** An application that wants fail-open
  wraps its store and returns a synthetic count; that choice is then visible in its own code rather
  than buried in the framework's.
