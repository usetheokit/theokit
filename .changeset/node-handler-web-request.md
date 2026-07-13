---
"theokit": patch
---

Fix (#117): route handlers now receive a Web `Request` as `ctx.request` in the Node server (dev + `theokit start`),
matching the public `request: Request` handler type and ADR-0028 R3a. Previously the Node executor leaked
the raw `IncomingMessage`, so any Web-standard use of `ctx.request` — e.g. `ctx.request.headers.get(...)` or
`createSessionManagerWeb.getSession(ctx.request)` — threw `request.headers.get is not a function` at runtime
even though it type-checked. This made the framework's own Web session primitive unusable from a handler in
the Node server. The handler request carries method + URL + headers (the request body remains available via
the typed `ctx.body`, since the Node stream is already parsed before the handler runs).
