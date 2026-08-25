---
'theokit': minor
---

`theo start` refuses to bind a public interface while write routes are unauthenticated, `HOST` reaches the listener, and identity from a plugin hook survives to the route policy.

Three changes that only make sense together, and one of them can stop a deploy — read the migration note.

**A route table nobody protected could still bind every interface.** ADR 0001 made every route declare who may call it and stopped absence from meaning open. That is half a guarantee: `'public'` is a declaration too, so a table where every entry says it passes the build gate perfectly and protects nothing. The policy value never left the module, so nothing downstream could tell "declared and guarded" from "declared and open". The scanner now records which methods declare the literal `'public'`, and `theo start` refuses a non-loopback bind while any POST / PUT / PATCH / DELETE is one of them, naming each offending route.

Public GET / HEAD / OPTIONS are deliberately untouched. Read endpoints are ordinary — health checks, catalogues, landing APIs — and a gate that fired on them would be switched off within a day. So this does **not** protect a public GET that leaks data; that is authorization work the policy function must do.

**`HOST` was inert, so the container fix it was added for never applied.** The config schema defaulted `host` to the string `'localhost'`, and an explicit host outranks the environment by design — so every app looked like it had decided, and the env branch was unreachable. A platform setting `HOST=0.0.0.0` got a server bound to the loopback, which inside a container means nobody. The default is gone; the loopback fallback lives where "nobody said" is still distinguishable from "somebody said localhost". An explicit `host: 'localhost'` still wins over `HOST`, and `host: false` still refuses it.

**Identity set by a plugin's `onRequest` hook is no longer discarded before the policy reads it.** The executor promised the opposite in-source, and held only for apps with no `server/` directory — which no real app is: the middleware stage replaced the context object, and everything a hook had written went with it. A plugin that authenticated a request was then not believed, so an app could not use a real policy at all and the workaround was `policy('public')` plus a hand-rolled check in every handler. Routes now merge, as the action executor beside them always did.

**To upgrade.** If `theo start` now refuses where it used to serve, the message names every route: each is an unauthenticated write that was reachable from the network. Two honest resolutions —

- give each one a real policy: `policy(({ subject }) => subject !== null)`, or `requireOwner(subject, record.ownerId)`. A plugin hook establishes `ctx.subject` and the policy reads it — the third fix above is what makes this work at all.
- decide otherwise, in writing: `security: { allowUnauthenticatedWrites: true }`. The routes stay open, and every start re-lists them.

A manifest built before this carries no policy kinds; it reports `unverified` and still boots, because reading absence as safety is the failure the gate exists to prevent.

Two more upgrades may surprise: a container that set `HOST` and quietly bound the loopback will now bind what it asked for, and an `onRequest` hook that wrote to `ctx` will now be seen by the handler.
