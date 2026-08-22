# ADR 0003 — One middleware contract, and it wraps the downstream

- **Status:** Proposed (2026-08-22) — requires the project owner's acceptance
- **Date:** 2026-08-22
- **Deciders:** program coordinator; requires the project owner's acceptance
- **Blocks:** M13 (middleware-edge) first minimum-contract criterion; usetheokit/theokit#345

## Context

This repository has **three** middleware contracts. The report that opened #345 named two.

| Where | Shape | Can it wrap the downstream? |
| --- | --- | --- |
| Published builder — `middleware()`, `defineMiddleware` (`server/define/define-middleware.ts:1`) | `(request: Request, next: (request) => Promise<Response>) => Response` | Yes |
| Node file-scan runner (`server/http/middleware-runner.ts:36`) | `(req: IncomingMessage, res: ServerResponse, next: () => void) => void` | No |
| Web runner — `WebMiddleware` (`server/http/web-middleware-runner.ts:19`) | `(request: Request, context) => Response \| void` | No |

The published one — the shape the documentation teaches and the builder produces — is invoked by
**neither runner**. `web-middleware-runner.ts` records the situation in its own header: *"this is its
own middleware contract … Full semantic parity with the Node `defineMiddleware` contract is part of
the deferred Node→Web pipeline convergence, not this slice."* The convergence was deferred and never
scheduled.

**How it fails today.** Both shapes are functions, so the Node runner's `typeof mw !== 'function'`
screen passes and the handler is called with `request = req` and `next = res`. Calling
`next(request)` calls `res(...)` and raises a `TypeError` from inside framework code. Returning a
`Response` instead leaves the runner's own `next` uncalled, so the request aborts and **writes
nothing** — a blank page from a middleware that reads as correct, which is the more common outcome
and the worse one.

A refusal landed in `095c786d1`: `defineMiddleware` marks the shape it declares and the Node runner
refuses a marked handler by name. That makes the mismatch audible. It is not the fix, and this ADR
exists because the fix is a decision rather than a patch.

## Decision

**Adopt the wrapping contract — `(request, next) => Response` — as the single middleware contract,
and compose the chain around route execution rather than before it.**

1. The published builder's shape becomes the only one. `WebMiddleware` and the Node `MiddlewareFn`
   are retired.
2. Both runners compose the chain as a fold: the innermost `next` executes the route and returns its
   `Response`. A middleware that returns without calling `next` short-circuits, as today.
3. The Node path adapts at its edge. `req`/`res` become a `Request` on the way in and the returned
   `Response` is written out — the direction `adapters/web-shim.ts` already travels, in reverse.
4. Per-request state moves from `WebMiddleware`'s mutable `context` argument onto the request-scoped
   context the route executors already carry, so one mechanism carries per-request state instead of
   two.

## Alternatives considered

**Adopt `(request, context) => Response | void` — the Web runner's shape — and change the builder.**
Cheaper: neither runner restructures, because nothing needs the downstream. Rejected because it
removes a capability the published contract already promises and applications reasonably expect:
timing the downstream, wrapping it in `try`/`catch`, retrying it, or setting a header *after* the
route ran. A contract that cannot express "around" is not a middleware contract; it is a
before-hook, and calling it middleware would mislead every reader who has met one elsewhere.

**Keep both contracts and make the builder emit the right one per directory.** `server/middleware/`
gets the Node shape, the Web path keeps `WebMiddleware`. Cheapest, and it closes #345 literally.
Rejected because it makes the framework's own three-target rule false for this surface: a middleware
authored once would not run on both, and `three-target-parity.md` calls a capability reachable from
one target only a defect rather than a smaller feature.

**Leave it, and keep the refusal.** The mismatch is audible, so nobody is silently broken. Rejected
as an end state: the published builder is documented, exported and unusable, which is worse than not
shipping it. But it is the correct interim, and it is what ships until this ADR is accepted.

## Consequences

- **Breaking for anyone with a `server/middleware/` file**, which is the whole point: those files
  are written to the Node shape today. A codemod can rewrite the common cases — `(req, res, next)`
  with a bare `next()` becomes `(request, next) => next(request)` — and cannot rewrite one that
  writes to `res` directly. That case needs a human, and the build should name the file rather than
  transform it wrongly.
- **The Node pipeline changes shape.** `runMiddlewareAndContext` returns `{ ctx, aborted }` and the
  caller runs the route afterwards; folding the chain around route execution means the runner owns
  the call. That is the substantial half of the work and the reason this is an ADR.
- **`WebMiddleware`'s mutable `context` disappears.** Middlewares that mutate it move to the
  request-scoped context, which is a smaller change than it sounds because the executors already
  thread one.
- **One contract to document, and the docs stop teaching a shape that does not run.**

## Verification

The claim to prove is the three-target one, so the test is the same route reached two ways:

- a middleware authored with `middleware()` and placed in `server/middleware/` runs on the Node
  file-scan path **and** on `executeWebRequest`, observed by its effect on the response;
- one that returns a `Response` without calling `next` short-circuits on both, with the route
  handler never invoked;
- one that calls `next` and then mutates the returned `Response` sees the route's own response on
  both — the capability this contract is chosen for, and the one the rejected alternative cannot
  express;
- a middleware requiring a runtime capability the target lacks is refused by name, not skipped
  (M13's second minimum-contract criterion).

Until then the refusal in `095c786d1` stands, and `#345` stays open.

## References

- `usetheokit/theokit#345` — the report, and the refusal that made it audible
- `.claude/rules/three-target-parity.md` — why two contracts is a defect rather than a trade-off
- `packages/theo/src/server/http/web-middleware-runner.ts` — where the deferral is recorded
- `docs/adr/0001-authorization-is-transport-independent.md` — the precedent for splitting a concern
  into a transport-independent decision and a per-transport edge
