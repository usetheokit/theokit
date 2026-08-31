---
'theokit': minor
---

**A `@Controller` route runs the plugin lifecycle** (#607).

`dispatchControllerRequest` had no parameter for a plugin runner, so neither of its two callers
could pass one. A controller route therefore ran no hook at all under `theokit start` — not
`onRequest`, not `preHandler`, not `onResponse`, not `onError` — and under `theokit dev` only the
`onRequest` the middleware happened to fire before matching, which reached controllers by accident
rather than by design.

Measured against a real adopter: its identity plugin had never run, so `ctx.subject` was never
populated, while the boot log reported the plugin registered. Nobody noticed because the app's
guards read the session from the `Request` directly. An app using `.policy(({ subject }) => …)` on
a controller route would have been refusing every caller instead. The same app then added rate
limiting to three routes that bill a third party per call, wrote it as a `preHandler`, and it
enforced nothing while reading exactly like protection.

**`onRequest` fires once per request in `theokit dev`, not twice** (#609).

The dev middleware called `runOnRequest` before matching a route, and `executeRoute` called it
again for the route it matched. Nothing deduped them, so every matched file route fired `onRequest`
twice in dev and once under `theokit start`. Anything a hook counted, billed, audited or traced was
doubled on the surface nobody instruments and correct on the one that ships.

The pre-match call still exists, and still does the job it was added for — letting a plugin serve a
path no route owns, such as `@theokit/plugin-openapi` on `/api/docs`. It has moved to the end of
that arm, so it runs only when neither a file route nor a controller owns the request.

Both defects had one cause: the dev middleware had a second, uncoordinated entry into the
lifecycle, and the controller path had none. Fixing either alone makes the other worse, which is
why they ship together.

**What this changes for an existing app.** A `preHandler` that short-circuits now applies to
controller routes, where it previously did not. If a hook was written expecting to govern only file
routes, it now governs both — which is the contract as documented, and may refuse traffic the app
was serving. A hook whose side effect was tuned around the doubled dev count will now see half as
many in dev, matching what production always reported.

Hooks still cannot reach a controller handler's arguments: a controller method receives its inputs
through parameter decorators, so a decoration written onto the plugin `ctx` has no seam to arrive
through. Only file routes read `ctx`. That limit is unchanged by this fix and is not what either
issue reported.
