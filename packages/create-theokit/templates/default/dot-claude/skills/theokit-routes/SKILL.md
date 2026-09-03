---
name: theokit-routes
description: TheoKit server routes — the route() builder, Zod validation, HTTP methods, dynamic params, error handling
user-invocable: false
paths:
  - 'src/server/routes/**'
  - 'server/actions/**'
---

# TheoKit Routes

## The `route()` builder

```typescript
import { route } from 'theokit/server/define'
import { z } from 'zod'

// GET — no body, optional params/query
export const GET = route()
  .policy('public') // who may call it — required
  .params(z.object({ id: z.coerce.number() })) // URL params
  .query(z.object({ page: z.coerce.number().optional() })) // query string
  .handler(({ params, query }) => ({ id: params.id, page: query?.page }))
  .build()

// POST — body validation + custom status
export const POST = route()
  .policy(({ subject }) => subject !== null) // any authenticated caller
  .body(
    z.object({
      title: z.string().min(3),
      done: z.boolean().default(false),
    }),
  )
  .status(201)
  .handler(({ body }) => {
    // body is fully typed from the Zod schema
    return db.insert(tasks).values(body).returning().get()
  })
  .build()
```

The chain is `.policy()`, `.params()`, `.query()`, `.body()`, `.status()`, `.response()`,
`.csrf()`, `.handler()`, and `.build()` closes it. `server/routes/health.ts` in this project is a
working one — read it rather than this block if the two ever disagree.

`.csrf(false)` opts a single route out of CSRF enforcement. It is for endpoints that legitimately
receive third-party POSTs — a Stripe or WhatsApp webhook, an OAuth callback — which authenticate by
signature rather than by session. `policy('public')` answers a different question (may an
unauthenticated caller reach this) and does NOT lift the CSRF gate: without `.csrf(false)` a webhook
is refused `CSRF_INVALID` before its signature is ever checked.

## policy — who may call this route

Required on every exported method. The scanner refuses a route file that omits it and names the
file, so absence is a build error rather than a route silently open to everyone.

```typescript
policy: 'public' // open, and said out loud
policy: ({ subject }) => subject !== null // any authenticated caller
policy: ({ subject, params }) => requireOwner(subject, ownerOf(params.id)) // this subject owns this record
```

`requireOwner` comes from `theokit/server`. The policy is evaluated identically over HTTP and
in-process, so a desktop or terminal surface gets the same answer a browser does. It receives no
headers and no cookies: identity arrives as `subject`, established by the transport.

## File-to-URL Mapping

| File path                          | URL               | Notes                    |
| ---------------------------------- | ----------------- | ------------------------ |
| `server/routes/health.ts`          | `GET /api/health` | Static route             |
| `server/routes/tasks/index.ts`     | `/api/tasks`      | Index route (GET + POST) |
| `server/routes/tasks/[id].ts`      | `/api/tasks/:id`  | Dynamic param            |
| `server/routes/users/[...slug].ts` | `/api/users/*`    | Catch-all                |

## `action()` (Server Actions)

```typescript
import { action } from 'theokit/server/define'
import { z } from 'zod'

export const createTask = action()
  .input(z.object({ title: z.string() }))
  .handler(({ input }) => db.insert(tasks).values(input).returning().get())
  .build()
```

The chain is `.input()`, `.accept()`, `.csrf()`, `.handler()`, and `.build()`.

## Error Handling

```typescript
import { TheoError } from 'theokit/server/http'

export const GET = route()
  .policy('public')
  .handler(({ params }) => {
    const task = db.select().from(tasks).where(eq(tasks.id, params.id)).get()
    if (!task) throw new TheoError({ code: 'NOT_FOUND', message: 'Task not found' })
    return task
  })
  .build()
```

Valid error codes: `BAD_REQUEST` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `UNPROCESSABLE_ENTITY` (422), `TOO_MANY_REQUESTS` (429), `INTERNAL_SERVER_ERROR` (500).

## Anti-patterns

- NEVER use `res.status().json()` — use `.status(201)` on the `route()` chain
- NEVER parse `req.body` manually — use `.body(z.object({ … }))` on the chain
- NEVER create routes outside `server/routes/` — they won't be discovered
- NEVER export non-HTTP-method names — only `GET`, `POST`, `PUT`, `DELETE`, `PATCH`
