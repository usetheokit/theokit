---
'@theokit/http': minor
'theokit': patch
---

A route that declared no access decision is now distinguishable from one declared open, and can be
refused.

`guards: []` meant two things at once (#576) — *"open on purpose"* and *"nobody said"* — and the
dispatcher, unable to tell them apart, took the permissive reading. For controllers that was safe
only while a separate build gate (#514) refused undeclared controller routes, which makes least
privilege a property of the **pipeline** rather than of the system; `@theokit/http` is published on
its own, so reaching the dispatcher without that build is an ordinary way to use it. Agent routes
had neither gate: they are auto-wired, dispatched before everything else, and a capability-authored
agent has no class to hang `@UseGuards` on, so `guards` was `undefined` → `?? []` → served.

- `AgentAppEntry.access?: 'public' | 'guarded'` makes the decision explicit. A non-empty `guards`
  still counts as a declaration, so nothing that already guards its routes has to re-declare it.
- Every undeclared route warns **once at mount**, naming the route and the remedy for its own
  surface (`access: 'public'` for an agent entry, `@Public()` for a controller).
- `TheoAppOptions.undeclaredRoutes: 'warn' | 'deny'` — `'deny'` answers 403 instead.

**The default is `'warn'`, and that is deliberate.** Flipping it here would break every app whose
agent endpoints are open today — precisely the population this issue is about — inside a non-major
release. It becomes `'deny'` in the next major; `'deny'` is available now for anyone who wants the
property before then.

`emit-controllers` now imports `PUBLIC_ROUTE_METADATA` from `@theokit/http` instead of redeclaring
it, and its refusal message teaches `@Public()` rather than the raw `@SetMetadata` string.
