---
name: theokit-routes
description: TheoKit server routes — defineRoute, Zod validation, HTTP methods, dynamic params, error handling
user-invocable: false
paths:
  - "server/routes/**"
  - "server/actions/**"
---

# TheoKit Routes

## defineRoute API

```typescript
import { defineRoute } from 'theokit/server/define'
import { z } from 'zod'

// GET handler — no body, optional params/query
export const GET = defineRoute({
  params: z.object({ id: z.coerce.number() }),   // URL params
  query: z.object({ page: z.coerce.number().optional() }), // Query string
  handler: ({ params, query }) => {
    return { id: params.id, page: query?.page }
  },
})

// POST handler — with body validation + custom status
export const POST = defineRoute({
  body: z.object({
    title: z.string().min(3),
    done: z.boolean().default(false),
  }),
  status: 201,
  handler: ({ body }) => {
    // body is fully typed from Zod schema
    return db.insert(tasks).values(body).returning().get()
  },
})

// PUT, DELETE follow the same pattern
export const PUT = defineRoute({ body: z.object({...}), handler: ({body, params}) => {...} })
export const DELETE = defineRoute({ params: z.object({id: z.coerce.number()}), handler: ({params}) => {...} })
```

## File-to-URL Mapping

| File path | URL | Notes |
|-----------|-----|-------|
| `server/routes/health.ts` | `GET /api/health` | Static route |
| `server/routes/tasks/index.ts` | `/api/tasks` | Index route (GET + POST) |
| `server/routes/tasks/[id].ts` | `/api/tasks/:id` | Dynamic param |
| `server/routes/users/[...slug].ts` | `/api/users/*` | Catch-all |

## defineAction (Server Actions)

```typescript
import { defineAction } from 'theokit/server/define'
import { z } from 'zod'

export const createTask = defineAction({
  input: z.object({ title: z.string() }),
  handler: ({ input }) => {
    return db.insert(tasks).values(input).returning().get()
  },
})
```

## Error Handling

```typescript
import { TheoError } from 'theokit'

export const GET = defineRoute({
  handler: ({ params }) => {
    const task = db.select().from(tasks).where(eq(tasks.id, params.id)).get()
    if (!task) throw new TheoError({ code: 'NOT_FOUND', message: 'Task not found' })
    return task
  },
})
```

Valid error codes: `BAD_REQUEST` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `UNPROCESSABLE_ENTITY` (422), `TOO_MANY_REQUESTS` (429), `INTERNAL_SERVER_ERROR` (500).

## Anti-patterns

- NEVER use `res.status().json()` — use defineRoute with `status:` option
- NEVER parse `req.body` manually — use `body: z.object(...)` in defineRoute
- NEVER create routes outside `server/routes/` — they won't be discovered
- NEVER export non-HTTP-method names — only `GET`, `POST`, `PUT`, `DELETE`, `PATCH`
