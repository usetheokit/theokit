---
'theokit': minor
---

**Breaking (types):** `MiddlewareHandler` — what `middleware().handle(fn).build()` and
`defineMiddleware(fn)` accept — changed from `(request, next) => Response` to
`(request, context) => Response | void`. Return a `Response` to answer the request; return nothing to
continue to the next middleware and then the route.

The old shape described a continuation pipeline nothing in the framework implements, and it had zero
runtime consumers: a middleware authored through the documented builder could not be invoked by the
runner that loads `server/middleware/*.ts`. Any code written against the old signature never ran, so
the compile error this raises is the first honest signal it could get.

Express-style `(req, res, next)` middleware files are unaffected and keep working; both shapes now
run, in filename order. Web-shaped middleware can also decorate the route's `ctx`, which no file
middleware could do before.
