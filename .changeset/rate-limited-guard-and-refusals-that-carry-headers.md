---
'theokit': minor
'@theokit/http': minor
---

**A controller route can name a rate limit, and a guard can refuse with 429** (#612).

`theokit/server/rate-limit` exported a complete limiter and nothing a `@Controller` route could use,
so every app wrote the adapter — the third instance of a pattern whose first two shipped as
`@Public()` and `Authenticated()` (#574). The hand-written adapter could not be correct, for two
reasons that were not the author's fault:

- **A guard could not answer 429.** `canActivate` returns a boolean, so a refused caller received
  `403 Forbidden resource` and the `X-RateLimit-*` the limiter had just computed were discarded —
  a guard owns no response to attach them to. "You are not allowed" and "you are allowed, later"
  read identically, and a well-behaved client had nothing to back off on.
- **The intuitive alternative was silently inert.** A `preHandler` plugin enforced nothing on
  controller routes (#607, fixed in the same line of work) while reading exactly like protection.

**`theokit/server/rate-limit` now exports `RateLimited`:**

```ts
@Post('stt')
@UseGuards(Authenticated(sessions), RateLimited({ max: 20, windowMs: 60_000 }))
transcribe() { ... }
```

A refused caller gets `429` with `Retry-After`, `X-RateLimit-Limit` and `X-RateLimit-Remaining`.
`scope: 'shared'` pools several routes into one budget, which is what an app capping endpoints that
bill a third party per call actually wants. The constructor **throws** on a configuration that
cannot tell callers apart — `keyBy: 'ip'` with no `trustProxy` and no `identify` — because a Web
`Request` has no socket address, and accepting it would put every visitor in one bucket: a limiter
that refuses the whole internet after N requests while reading as protection until it does. It does
not attach `X-RateLimit-*` to allowed responses, and says so in its docblock rather than shipping a
header that appears under one dispatcher and vanishes under another.

**`@theokit/http`:**

- `HttpException` accepts and carries `headers`, and every dispatcher renders them through one
  `httpExceptionToResponse` instead of four hand-built `new Response(...)` calls. `429` without
  `Retry-After`, `401` without `WWW-Authenticate` and `405` without `Allow` are all half an answer.
- The guard pipeline is one `runGuards` shared by `TheoApp`, `createDecoratorHandler` and the
  TheoKit plugin, instead of four copies — the arrangement #576 already paid for once. A guard
  throwing an `HttpException` now reaches the client with its status and headers on all three, agent
  routes included, where the exception previously escaped the dispatcher entirely.
- The published types say these exceptions are `Error`s again. `tsup` had been erasing the
  inheritance into an anonymous structural type, so an app writing `throw new UnauthorizedException()`
  tripped `@typescript-eslint/only-throw-error` against the framework's own exceptions — and the
  lint was right about what the `.d.ts` claimed.
