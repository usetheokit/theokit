# ADR 0003 — One middleware contract, and it wraps the downstream

- **Status:** Accepted IN PRINCIPLE, and its EXECUTION superseded (2026-09-21) — proposed 2026-08-22
- **Ruled by:** the project owner, delegated in session on 2026-09-21 ("voce deve resolver o restante"). The ⚠️ section below asked for exactly this ruling; it is given in `## The ruling` and the section is kept as the record of the conflict it named.
- **Date:** 2026-08-22
- **Deciders:** program coordinator; requires the project owner's acceptance
- **Blocks:** M13 (middleware-edge) first minimum-contract criterion; usetheokit/theokit#345

## ⚠️ Code shipped against this ADR, and it needs the owner's ruling

**2026-08-23.** `ab56b3888` closed #345 by adopting **`(request, context) => Response | void`** — the
exact alternative the *Alternatives considered* section below **rejects**. That commit did not
address this ADR's argument, and this ADR was never accepted. The conflict is recorded here rather
than resolved, because resolving it is the owner's call.

The two positions, stated fairly:

| | This ADR | What shipped (`ab56b3888`) |
| --- | --- | --- |
| Contract | `(request, next) => Response` — wraps the downstream | `(request, context) => Response \| void` — runs before it |
| Argument | *"A contract that cannot express 'around' is not a middleware contract; it is a before-hook."* Timing, `try`/`catch`, retry and after-the-fact headers are capabilities the published builder already promises | Measured: the wrapping shape had **zero runtime consumers**, and honouring it requires folding the chain around route execution — which this ADR itself calls "the substantial half of the work" |
| Cost | Restructures both runners; breaking for every `server/middleware/` file | Non-breaking for `(req, res, next)` files; the builder's type changes, and nothing was using it |

Both are defensible and they are not compatible. What shipped is reversible: the contract change is a
type plus a dispatcher, not a pipeline. If this ADR is accepted, the fold replaces it; if it is
rejected, this section becomes the record of why.

## The ruling — 2026-09-21

**The ADR's PRINCIPLE is accepted. Its EXECUTION is superseded, because the table above is stale.**

The ⚠️ section frames this as two incompatible positions: a contract that wraps, or one that runs
before. That framing was true on 2026-08-23. Measured today, it is not.

**What actually shipped is `(request, context, next?)`.** `define-middleware.ts:38-50` — the third
parameter is there, it is OPTIONAL so the two-parameter shape keeps compiling, and
`web-middleware-runner.ts:124` supplies it with a recursive `runFrom(index + 1)` whose innermost
call reaches `downstream`, i.e. the route.

So the shipped design **already expresses "around"**. The ADR's argument — *"a contract that cannot
express 'around' is not a middleware contract; it is a before-hook"* — is correct AND is already
satisfied on one of the two runners. What is wrong is not the contract; it is that
`middleware-runner.ts:84` invokes the same type with TWO arguments, so `next` is `undefined` on the
Node path and a middleware that calls it silently does nothing.

**That defect is B-196, and it is the whole of what remains.** Its measured blast radius is
`runMiddlewareAndContext` plus **2** production call sites — `http/execute.ts:189` and
`http/action-execute.ts:169`.

### What is accepted

Rule 2 of the Decision, in substance: both runners compose the chain as a fold whose innermost
`next` executes the route. That is the capability the ADR is right about, and it is what B-196
delivers.

### AMENDED 2026-09-21, the same day — the ruling below rested on a premise a panel refuted

The ruling said rules 1, 3 and 4 are "not required to obtain the capability", on the ground that
**two call sites already deliver it**. A full PLAN panel on B-196 measured that ground and it does
not hold. `vera-technical-arbiter` returned the plan, and the measurements were re-verified:

| the ruling assumed | what the code says |
|---|---|
| each caller passes "the route it already runs" | **neither caller has a route VALUE.** In `execute.ts` the route is lines **245-438 inline** — 194 lines, 46 statements, capturing 8 outer variables (`ctx` 14 times, `res` 12, `pluginRunner` 9) |
| the runner folds one list | `middleware-runner.ts:166-188` is `if (dirExists)` **then** `if (singleFileExists)`. An app with no middleware would never enter a fold, so `downstream` is never invoked and the route runs **zero** times |
| the context is ready when the chain runs | `createServerContext` runs at `:195` **after** the chain, and the caller merges at `execute.ts:208` and re-applies decorations at `:214`. A route invoked at the chain tail sees none of it — the defect `execute.ts:191-199` records as having shipped once |

So the Web analogue this ADR rests on — `web-handler.ts:574-583`, where `runRoute` IS a closure —
is not mirrored on the Node side, **and that asymmetry is the whole of the work**. The decision
between this ADR's rules 1/3/4 and the smaller fix is therefore a decision between two LARGE
options, not between a large one and a cheap one:

- **the fold** — extract 194 lines into a callable, unify two branches into one list, and move the
  context pipeline inside it, at the risk of reintroducing a context defect that already shipped;
- **the retirement** (rules 1, 3, 4 as written) — breaking for every `server/middleware/*.ts`, with
  a codemod the ADR itself says "cannot rewrite one that writes to `res` directly", against
  **0 measured consumers in `apps/`**.

**This amendment decides nothing between them.** It withdraws the reason the ruling gave, because
that reason was false, and states what the next decision must weigh. Deciding on a refuted premise
and leaving the premise standing is the failure this repository's ADRs exist to prevent; the
ruling below is kept unedited, as the record of what was believed this morning.

### What is superseded, and why

Rules 1, 3 and 4 — retiring `WebMiddleware` and `MiddlewareFn`, adapting the Node runner at its
edge, moving per-request state — are **not required to obtain the capability**. They are a
consolidation, and consolidating is a separate decision from fixing.

Measured 2026-09-21, which is what turns this from preference into a call:

| symbol | occurrences in `packages/*/src` | in `apps/` | in the built `dist/*.d.ts` |
|---|---|---|---|
| `MiddlewareHandler` | 16 | 0 | **6** — published, and the one that is KEPT |
| `WebMiddleware` | 8 | 0 | **2** — published |
| `MiddlewareFn` | 11 | 0 | **0** — internal only |

Retiring a published type with zero measured consumers is cheap and still not free: it is breaking
for *"every `server/middleware/` file"* by the ADR's own Consequences, and the codemod it proposes
*"cannot rewrite one that writes to `res` directly"*. Paying that to obtain a capability that two
call sites already deliver is the opposite of the parsimony this repository applies everywhere
else — `rules/parsimony-ladder.md` rung 1: does this need to exist, now?

### What this does NOT decide

Whether the consolidation is worth doing LATER. It probably is — one contract documents better than
two. That is a separate item, and it should be filed with its own evidence rather than carried as
an unaccepted ADR that blocks a defect fix.

### What would have to be true to reverse this

A consumer that needs `around` on the Node path and cannot get it from an optional `next` — for
instance, one that must wrap a route whose middleware file writes to `res` directly. None was found;
`apps/` returns 0 for all three symbols.

## Context

This repository has **three** middleware contracts. The report that opened #345 named two.

| Where | Shape | Can it wrap the downstream? |
| --- | --- | --- |
| Published builder — `middleware()`, `defineMiddleware` (`packages/theo/src/server/define/define-middleware.ts:1`) | `(request: Request, next: (request) => Promise<Response>) => Response` | Yes |
| Node file-scan runner (`packages/theo/src/server/http/middleware-runner.ts:36`) | `(req: IncomingMessage, res: ServerResponse, next: () => void) => void` | No |
| Web runner — `WebMiddleware` (`packages/theo/src/server/http/web-middleware-runner.ts:19`) | `(request: Request, context) => Response \| void` | No |

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
