# ADR 0001 — Authorization is transport-independent; transport concerns stay on the transport

- **Status:** Proposed
- **Date:** 2026-08-19
- **Deciders:** program coordinator (this ADR requires the project owner's sign-off before M1 starts)
- **Blocks:** M1 (server-boundary-security), and through it every other three-target milestone

## Context

`three-target-parity.md` requires that no core capability be reachable from only one target. Access control is a core capability by any reading of that rule.

Today it is reachable from one target. Measured on 2026-08-19:

- `callProcedure` — the seam TUI, Tauri and MCP surfaces use — runs **no middleware and no auth**. This is deliberate and documented (`packages/theo/src/server/http/in-process-caller.ts:5-6,69`), on tRPC's `callProcedure` precedent, and input validation *is* shared with the HTTP path, so there is no validation drift.
- Auth is typed on the transport: `session.ts:1,49,141` takes `IncomingMessage`/`ServerResponse` and writes `Set-Cookie`. There is no `res` on an IPC call and no cookie jar in a terminal.
- Both middleware runners are transport-bound — `middleware-runner.ts:6-7` on `node:http`, `web-middleware-runner.ts:19` on `Request`.
- The framework offers `requireAuth` (`server/auth/auth.ts:11`) and nothing for authorization. Every action re-invents "may this subject touch this record".

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

## Verification

- A test that reaches the same route over HTTP and through `callProcedure` and asserts an identical access decision for the same subject. That test is the ADR: without it, the claim "not a second implementation" is unenforced.
- The HITL endpoints reject an unauthenticated caller and an authenticated non-owner, exercised against the published build (M1 DoD).
- A route with no declared policy fails the build, naming the file.

## References

- `rules/three-target-parity.md` § Current state — the measurement this decision responds to
- `packages/theo/src/server/http/in-process-caller.ts:5-6,69` — the documented no-middleware contract
- `packages/theo/src/server/auth/session.ts:1,49,141` — the transport coupling to remove
- `ROADMAP.md` § M1 — the DoD this ADR must satisfy
- GHSA-g94h-459g-rjhj — the advisory that is the same failure one layer up
- `BACKLOG.md` B-003 (#345), B-005 (#347) — the middleware-contract and wiring work this depends on
