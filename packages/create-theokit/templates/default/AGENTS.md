# AGENTS.md — TheoKit App

Guide for coding agents (Claude, Copilot, Cursor) working on this TheoKit project.

## Architecture

This is a **full-stack TypeScript app** built with TheoKit — a framework for AI agent apps.

```
server/
  routes/             → HTTP API routes (defineRoute + Zod validation)
    health.ts         → GET /api/health
    tasks/
      index.ts        → GET /api/tasks (list) + POST /api/tasks (create)
      [id].ts         → GET/PUT/DELETE /api/tasks/:id
  db/
    schema.ts         → Drizzle ORM schema (SQLite)
    index.ts          → DB connection + auto-create tables
    seed.ts           → Seed data (run with `npm run seed`)
app/
  page.tsx            → React frontend
  layout.tsx          → Root layout
tests/
  tasks.test.ts       → Example API smoke test
```

## Key Patterns

### Routes (defineRoute)
```typescript
import { defineRoute } from 'theokit/server/define'
import { z } from 'zod'

export const GET = defineRoute({
  handler: () => db.select().from(tasks).all(),
})

export const POST = defineRoute({
  body: z.object({ title: z.string().min(3) }),
  status: 201,
  handler: ({ body }) => db.insert(tasks).values(body).returning().get(),
})
```

### Database (Drizzle + SQLite)
```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
})
```

### Validation
- **Zod is the single source of truth** — define schema once, get types + validation + OpenAPI
- `body: z.object(...)` in defineRoute validates automatically, returns 422 on failure
- Use `z.infer<typeof schema>` for TypeScript types

### Dynamic Routes
- `server/routes/tasks/[id].ts` → `/api/tasks/:id`
- Params validated with `params: z.object({ id: z.coerce.number() })`

### Path Aliases
- `@/*` → project root (configured in tsconfig.json)
- `@/server/*` → `./server/*`

## Commands

```bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run start        # Run production build
npm run test         # Run tests (vitest)
npm run seed         # Seed database with sample data
npm run lint         # ESLint check
npm run format       # Prettier format
npm run typecheck    # TypeScript type check
```

## Don't

- Don't use `any` — use Zod schemas + `z.infer<>`
- Don't write raw `res.status().json()` — use defineRoute with status option
- Don't parse request body manually — use `body: z.object(...)` in defineRoute
