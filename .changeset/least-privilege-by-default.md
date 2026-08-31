---
'@theokit/http': major
'theokit': minor
---

**An undeclared route is refused instead of served, in every dispatcher** (#576).

A controller or agent route that declares neither a guard nor an explicit "open on purpose" now
answers 403. `undeclaredRoutes` defaulted to `'warn'` in `@theokit/http@1.2.0`, which served the
request and logged a line promising this change; a safe default an app has to switch on protects
only the apps that were already reading their logs.

The check also reached one dispatcher out of three. `@theokit/http` ships `TheoApp`,
`createDecoratorHandler` and `httpDecoratorsPlugin` over the same route metadata, and the framework's
own controller dispatch — `theokit dev`, `theokit start` — reuses `createDecoratorHandler`, which
looked at the question nowhere. The decision is computed once now, on the metadata walk
(`WalkResult.access`), so a fourth dispatcher cannot ship without it.

`@UseGuards()` with no arguments no longer counts as a declaration, at dispatch or at build. It
named nobody who decides while reading as guarded, and the two gates disagreed about it: the build
passed and the request was served unguarded.

Migration: `@Public()` for a route anyone may call, `@UseGuards(...)` for one someone decides,
`access: 'public'` / `guards: [...]` on an agent entry. `undeclaredRoutes: 'warn'` restores the
previous behaviour per app while you migrate. Full guide in `MIGRATION.md`.

**`Authenticated(sessions)` — the guard every app was writing by hand** (#574).

`theokit/server/auth` now exports the controller equivalent of
`.policy(({ subject }) => subject !== null)`. Measured in the first real adopter: 8 controllers, 6
copies of a 22-line `AuthGuard`, and the first version of that class read the subject off the guard's
`ExecutionContext` — which carries no subject — so it denied everyone and passed the only test aimed
at it, because that test asserted an unauthenticated request is refused.
