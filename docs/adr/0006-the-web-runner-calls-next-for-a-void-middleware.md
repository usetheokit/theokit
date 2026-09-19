# ADR 0006 — The web runner calls `next` for a void middleware

- **Status:** Accepted (2026-09-19)
- **Date:** 2026-09-19
- **Decider:** the autonomous maintenance chain, under `rules/autonomy-envelope.md`
  § *A structural decision the contract wants recorded*
- **Relates to:** ADR 0003 (Proposed), B-003, usetheokit/theokit#345

## Why this ADR exists rather than an acceptance of ADR 0003

ADR 0003 reads **Proposed — requires the project owner's acceptance**, and says so four times.
A plan was written against it claiming to *execute* it; the review panel returned that plan 0/3, and
the orthogonal seat named the reason exactly: the plan kept `WebMiddleware`, appended `next` as a
third argument, and scoped itself to the Web runner, while ADR 0003 decides that `WebMiddleware` is
**retired** (§1), that the Node path **adapts at its edge** (§3), and that the `context` argument
**disappears** (§4).

So the plan was taking a decision while reporting that somebody else had taken it. That is the defect
being corrected here.

`rules/autonomy-envelope.md` permits this chain to decide — *"there is no separate act of approval to
perform"* — provided the record carries what a meeting would have. It does not permit claiming the
decision was already made. This ADR takes a **narrower** decision than ADR 0003 proposes, on its own
authority, and leaves ADR 0003 Proposed for the owner.

## Decision

**`runWebMiddleware` calls `next` itself when a middleware returns without a `Response`.**

The signature becomes `(request, context, next) => Response | undefined | void`:

1. A middleware that returns a `Response` short-circuits — the chain stops and that `Response` is
   returned verbatim. **Unchanged from today.**
2. A middleware that returns nothing **continues** — the runner invokes the rest of the chain on its
   behalf. **Unchanged from today**, and this is the clause that matters.
3. A middleware that awaits `next` observes the downstream result and may return a different
   `Response`. **New**, and it is the capability ADR 0003 exists to obtain.
4. `WebMiddleware` keeps its name and `context` keeps its position.
5. **The runner's downstream parameter is OPTIONAL and fourth.** Measured 2026-09-19: the existing
   call at `web-handler-params.test.ts:163` passes three positional arguments
   (`request`, `middleware`, `ctx`). An optional fourth leaves that call compiling unchanged. Omitted,
   the runner behaves exactly as today — it returns `undefined` when the chain falls through, so both
   production call sites and the EC-12 describe keep their current contract until they opt in.

6. **A frame yields the middleware's own `Response` when it returned one; otherwise, when the
   middleware invoked `next`, the frame yields what that invocation produced.** One rule, one value,
   in that order of precedence. The runner does not re-invoke the downstream on a frame where `next`
   was called, and does not discard what the downstream returned.

   **The order is the whole clause, and two panel rounds were spent reaching it.** Round 4 found the
   first version — which said "terminal" and named no value — drops the route's `Response`, because in
   this ADR's vocabulary terminal means the frame yields the MIDDLEWARE's return value, `undefined` for
   a void one. Round 5 found the fix for that stated the downstream's result **unconditionally**, which
   discards the `Response` of a middleware that awaits `next` and returns its own — the exact
   capability clause 3 exists to obtain, cancelled by clause 6, with clause 1 saying a third thing.
   Three clauses, one frame, three answers, and which one won was written nowhere: `grep -niE
   "precedence|wins|overrid"` returned zero hits across both documents. Found independently by all
   three reviewers of round 5.

   Both failures are the same defect with the quantifier moved. The precedence above is what makes the
   rule single-valued, so there is no frame for which two clauses answer.

   **The un-awaited case is why this yields the INVOCATION's result rather than a stored value.** Under
   clause 7 a middleware may call `next()` and return before it settles. A frame holding the downstream
   *value* reads `undefined` there and serves a blank page — the round-4 defect restored through the
   door clause 7 opens. The frame retains what `next()` returned and awaits it.

   **Rejected — the frame yields `undefined` whenever the middleware returned void.** It discards the
   route's `Response`, which is the outcome this ADR refuses by name below.

   **Rejected — the frame always yields the downstream's result.** It discards the `Response` of the
   middleware clause 3 exists for, quietly: after T1.3 the downstream's own `Response` is still served,
   so the middleware appears to work while its contribution is dropped.

7. **`invoked = true` executes synchronously when `next` is called, before any `await` inside it.**
   "Has invoked" means call-time, not completion-time. Set after an await, the frame reads `false`
   for a middleware that calls `next()` without awaiting, and the runner re-invokes the downstream —
   the very defect clause 6 exists to prevent.

   Without this clause the contract contradicts itself. Clause 2 says a void return continues — *the
   runner invokes the rest of the chain on its behalf*. Clause 3 says a middleware may await `next`
   itself. Under right-to-left composition *the rest of the chain* IS the same `next` thunk, so a
   middleware that awaits `next()` and then returns nothing has its downstream run **twice**.

   That is not a careless middleware. It is the shape AC-002 specifies as this plan's primary test:
   *a middleware that records after `await next()`*. Found by `vera-technical-arbiter` in the third
   panel round, and it is the same failure mode the second round found — a deciding fact absent from
   both documents, with two clauses resting on the unstated answer. Last round the question was
   *required or optional*; this one is *is `next` idempotent*.

   Implemented by retaining what `next()` returned, in a per-frame slot written synchronously by the
   call. The slot being non-empty IS "has invoked", so clause 7 holds by construction rather than by a
   second variable kept in step with the first.

   **Retaining is not memoising, and clause 6 requires the first while this clause rejects the
   second.** Retention lets the frame yield what the one invocation produced. Memoising would make a
   SECOND explicit `next()` return the first one's result — silencing a genuinely careless double
   call, which is the one thing the counter in AC-003 exists to detect. A second call overwrites the
   slot and really does invoke the downstream again, so the counter reads 2 and the test fails, which
   is correct. Raised by `vera-technical-arbiter` in round 5: as first written, this note forbade the
   retention clause 6 depends on, leaving the two mutually unsatisfiable.

## Who is affected

Found by `grep -rl` over `packages`, `tests` and `apps`, excluding `node_modules` and `dist`:

| Surface | Files | Effect |
|---|---|---|
| `WebMiddleware` | `web-middleware-runner.ts`, `web-handler.ts`, `tests/integration/web-handler-params.test.ts` | the type gains an optional third parameter |
| `runWebMiddleware` | the same three | the runner gains a downstream parameter |
| `MiddlewareHandler` | 8 files, including 3 test files carrying 13 cases | **untouched by this decision** |
| the Node `middleware-runner.ts` (218 rows, 3 integration suites) | — | **untouched by this decision** |

## What would break, and what would not

**Nothing breaks, and clause 5 is why.** The first version of this ADR rested "nothing breaks" on
the EC-12 describe passing unchanged, and `nemesis-claim-auditor` refused it: that was a claim about
a post-change state resting on a pre-change measurement, with the deciding fact — whether the new
parameter is required — stated in neither document.

It is now stated. With the downstream parameter OPTIONAL and fourth:

- `web-handler-params.test.ts:163` passes three arguments and keeps compiling — measured, that is
  exactly what it passes.
- Omitting it, the runner returns `undefined` on fall-through exactly as today, so `:177`'s
  `expect(res).toBeUndefined()` holds and `:178`'s `order` `[1, 2]` holds.
- A caller that DOES pass a downstream gets the wrapping semantics, and its own assertions describe
  the new contract.

So the EC-12 describe passes unchanged **because the change is opt-in**, not because a coincidence
happens to survive it.

This is the correction of a real design error. The returned plan declared "returned nothing without
calling `next`" to be **terminal**, which would have made every existing void middleware abort with
no `Response` — the blank page ADR 0003 itself calls *"the more common outcome and the worse one"*.
The error was caught by `vera-technical-arbiter` against two pieces of evidence: that test's ordering
assertion, and the runner's own comment documenting a void return as *"continue to the next
middleware / handler"*.

The change is **additive**: a middleware ignoring the third parameter keeps type-checking and keeps
behaving identically.

## What was rejected

**Accepting ADR 0003 as written, on this chain's authority.** It retires `WebMiddleware`, converges
the Node runner, and removes `context` — 11 files and 13 test cases across two runners, one of which
has three integration suites. The envelope permits the decision; it does not make a change of that
blast radius wise to take in the same breath as correcting a plan that misread the ADR. The narrow
decision delivers the capability ADR 0003 was written to obtain and leaves its wider clauses to the
owner, with this ADR as evidence that the capability no longer depends on them.

**Making a void return terminal (the returned plan's ADR-2).** Breaks every existing middleware into
a blank page. Rejected on the evidence above.

**Leaving the runner as it is and adapting at the builder.** ADR 0003 rejects this under *Alternatives
considered* and its reasoning stands: it removes a capability the published contract promises.

## Consequences

- ADR 0003 stays **Proposed**. Its §1, §3 and §4 are neither executed nor withdrawn by this.
- **`095c786d1`'s refusal does NOT stay, and this line claimed it did until round 5.** Measured
  2026-09-19: `ab56b3888` (2026-08-22) removed `refuseIncompatibleShape` and its 112-line test one day
  after `095c786d1` shipped them, replacing the refusal with a real fix. Nothing in this decision
  restores it; whether it should return is registered as B-193 and is not settled here.
- Whether `WebMiddleware` and `MiddlewareHandler` become one name remains open, and is now a smaller
  question because both can reach the same capability.
