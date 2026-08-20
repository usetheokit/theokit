# ADR 0001 — Authorization is transport-independent; transport concerns stay on the transport

- **Status:** Accepted (2026-08-20, project owner) — decision points 1-3 and 5 implemented and verified; point 4 deferred to its own breaking release
- **Date:** 2026-08-19
- **Deciders:** program coordinator; accepted by the project owner on 2026-08-20, including the breaking half
- **Blocks:** M1 (server-boundary-security), and through it every other three-target milestone

## Context

`three-target-parity.md` requires that no core capability be reachable from only one target. Access control is a core capability by any reading of that rule.

Today it is reachable from one target. Measured on 2026-08-19:

- `callProcedure` — the seam TUI, Tauri and MCP surfaces use — runs **no middleware and no auth**. This is deliberate and documented (`packages/theo/src/server/http/in-process-caller.ts:5-6,69`), on tRPC's `callProcedure` precedent, and input validation *is* shared with the HTTP path, so there is no validation drift.
- Auth is typed on the transport: `session.ts:1,49,141` takes `IncomingMessage`/`ServerResponse` and writes `Set-Cookie`. There is no `res` on an IPC call and no cookie jar in a terminal.
- Both middleware runners are transport-bound — `middleware-runner.ts:6-7` on `node:http`, `web-middleware-runner.ts:19` on `Request`.
- The framework offers `requireAuth` (`packages/theo/src/server/auth/auth.ts:11`) and nothing for authorization. Every action re-invents "may this subject touch this record".

The consequence is not theoretical. A route that enforces access rules over HTTP enforces none of them when the same route is reached in-process — which is the path the two new targets are built on. The open HITL advisory (GHSA-g94h-459g-rjhj) is the same failure one layer up: an endpoint whose only control was CSRF, which authenticates nobody.

**The question this ADR answers:** does authorization live in a transport-independent contract that both paths execute, or does each surface stay responsible for inventing it?

## Decision

**Split what middleware currently conflates.**

1. **Policy is transport-independent and declared per route.** Who the caller is, and whether they may perform this operation, becomes part of `RouteConfig` — evaluated by *both* the HTTP pipeline and `callProcedure`, from the same code.
2. **Transport concerns stay on the transport.** CORS, cookies, CSP headers, CSRF and header rewriting remain in the HTTP middleware chain and are never dragged into the in-process path, because they are meaningless there. CSRF on a terminal is not a gap; there is no browser origin to forge from.
3. **The framework supplies the authorization primitive it currently lacks** — an owner/subject check alongside `requireAuth` — so that "may this subject touch this record" has one implementation rather than one per action.
4. **Identity is supplied by the caller, not by the cookie.** `session.ts` loses `ServerResponse` from its public signature; the cookie becomes one implementation of a session store, and an IPC or terminal surface supplies identity through the same contract.
5. **A route declares its policy explicitly, including `public`.** Absence stops meaning "open".

## Alternatives considered

**A. Status quo — each surface is responsible.** Zero work, matches tRPC, and validation is already shared so the drift is bounded. Rejected: it makes access control a per-surface re-implementation, which is exactly what `three-target-parity.md` forbids, and it scales the number of places a mistake can be made with the number of targets. The HITL advisory shows what that costs when one of those places is missed.

**B. Run the whole middleware chain inside `callProcedure`.** Appealing because it reuses a mechanism that exists, and it is the shape the M1 DoD hints at. Rejected: today's middleware is transport-shaped — it reads `req`/`Request` and writes headers, cookies and status. Forcing the chain in-process would drag CORS, cookie and CSP semantics into a terminal, which is precisely the presentation-leaks-into-core failure the parity rule exists to prevent. It also cannot work without first solving #345, where the two middleware contracts already disagree with each other and with the public builder.

**C. Keep authorization in middleware but add an in-process shim that fakes a `Request`.** Cheapest to write. Rejected as the worst of both: it makes the in-process path *look* protected while its guarantees depend on how faithful the fake is, and a fake that drifts fails open silently. Fail-open by omission is the class this ADR exists to close.

**D. The chosen split.** Costs more than A and B, and touches `session.ts`'s public signature — a breaking change for consumers (`MIGRATION.md` discipline applies). Chosen because it is the only option where authorization has exactly one implementation and each target still gets the transport semantics that make sense for it.

## Consequences

**Enables.** A TUI or Tauri surface reaching a route gets the same access decision as a browser, from the same code. `requireOwner` (or its final name) becomes the shared answer to the question every action currently answers alone. A gate can require every route to declare a policy, turning the silent fail-open class into a build error — the same shape as the route scanner refusing `[[...slug]]` by name.

**Costs.** `session.ts`'s public signature changes, so this is a breaking release with a `MIGRATION.md` entry. `RouteConfig` grows a field, and every existing route needs a declared policy — mechanical, but it touches every route. `callProcedure` gains a policy phase, so its "no middleware chain" docstring must be rewritten to say what it *does* run, or the next reader will trust the old sentence.

**Risks.** Declaring `public` becomes the easy escape, and a codebase where everything is `public` has a gate that verifies nothing. Mitigation: `public` is explicit and greppable, so its use is measurable — which is more than can be said for the current state, where openness has no marker at all.

**Not decided here.** Where the policy is evaluated relative to the cache lookup. `define-cached-route.ts:70-73` already documents that middleware must run before the cache lookup, and nothing structurally guarantees it. That ordering deserves its own ADR alongside the cache wiring (B-005).

## Implementation status (2026-08-20)

Recorded here rather than in a commit message, because a reader arriving at this ADR needs to know
which parts of it are load-bearing today and which are still a decision on paper.

**Implemented and verified.** Points 1-3 and 5 of the Decision. `RouteConfig.policy` exists and is
evaluated by the Node executor, the Web executor and `callProcedure` from one function
(`packages/theo/src/core/contracts/route-policy.ts`). `requireOwner` is the primitive point 3 asks
for. The verification this ADR names as *"the test that IS the ADR"* exists and passes across all
three transports (`tests/unit/access-decision-parity.test.ts`), including the case that motivated the
whole decision: an authenticated non-owner, refused identically whether the route is reached over
HTTP or in-process.

Point 5 shipped on 2026-08-20 with the migration that makes it survivable. `scanServerRoutes`
refuses a route file whose HTTP export declares no policy and throws `MissingRoutePolicyError`
naming the file, the URL it serves and the silent methods
(`packages/theo/src/server/scan/detect-route-policy.ts`,
`packages/theo/src/server/scan/errors.ts`). The gate sits in the scanner rather than in the build
command because the scanner is the one path every entry point shares — `theo build`, `theo start`,
`theo dev`, `theo routes` and each generated adapter entry all call it, and a gate the six adapters
would have to remember to call is a gate that reports on the routes somebody remembered.

**Where the gate deliberately stops.** On routes read from the file system. A `RouteConfig` built in
memory and handed to `executeWebRequest` or `callProcedure` never passed a scanner, and
`evaluateRoutePolicy` still treats an undeclared policy as "not declared" rather than as denial.
Making the executors refuse it would convert a build gate into a runtime break for every direct
caller, which is the all-at-once failure this ADR routed through a migration in the first place.
`tests/unit/route-policy-declaration-gate.test.ts` holds both halves of that line.

**Not implemented, and deliberately.** Point 4. `session.ts` still carries `ServerResponse` in its
public signature. Identity reaches the policy through the run context each transport already builds,
so nothing is blocked on this today; removing the coupling is its own breaking release with its own
`MIGRATION.md` entry.

**What this means for M1 and M13.** The ROADMAP gates both on this ADR being "decided and
implemented". The decision is made and its core guarantee is enforced by a test; the milestones
still cannot close, because closing them requires `/acceptance` against a published build and nothing
has been released. The blocker those criteria describe — that `callProcedure` runs no auth — is no
longer accurate and the criteria should be re-read against this section rather than against the
sentence they were written from.

**One thing the implementation learned that the ADR did not anticipate.** The Node executor's handler
context is not the object passed to `executeRoute`; it is a separate run context built from middleware
and plugin decorations. Seeding identity on the call argument silently produced "not authenticated"
on every request, including the ones that should pass. Fail-closed, so it surfaced immediately — but
it is the kind of detail that makes "just evaluate the policy in all three places" a smaller sentence
than a change.

## Verification

- A test that reaches the same route over HTTP and through `callProcedure` and asserts an identical access decision for the same subject. That test is the ADR: without it, the claim "not a second implementation" is unenforced.
- The HITL endpoints reject an unauthenticated caller and an authenticated non-owner, exercised against the published build (M1 DoD).
- A route with no declared policy fails the build, naming the file. Enforced by `scanServerRoutes`; covered by `tests/unit/route-policy-declaration-gate.test.ts`.

## References

- `rules/three-target-parity.md` § Current state — the measurement this decision responds to
- `packages/theo/src/server/http/in-process-caller.ts:5-6,69` — the documented no-middleware contract
- `packages/theo/src/server/auth/session.ts:1,49,141` — the transport coupling to remove
- `ROADMAP.md` § M1 — the DoD this ADR must satisfy
- GHSA-g94h-459g-rjhj — the advisory that is the same failure one layer up
- `BACKLOG.md` B-003 (#345), B-005 (#347) — the middleware-contract and wiring work this depends on
