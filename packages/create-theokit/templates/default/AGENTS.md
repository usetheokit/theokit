# AGENTS.md — TheoKit App

Guide for coding agents (Claude, Copilot, Cursor) working on this TheoKit project.

## Architecture

This is a **full-stack TypeScript app** built with TheoKit — a framework for AI agent apps.

```
server/
  routes/             → HTTP API routes (defineRoute + Zod validation)
    health.ts         → GET /api/health
  db/
    schema.ts         → Drizzle ORM schema (SQLite) — empty, add your tables
    index.ts          → DB connection (better-sqlite3, WAL mode)
app/
  page.tsx            → React frontend
  layout.tsx          → Root layout
tests/
  tasks.test.ts       → Example unit test
```

## Key Patterns

### Routes (defineRoute)
```typescript
import { defineRoute } from 'theokit/server/define'
import { z } from 'zod'

export const GET = defineRoute({
  handler: () => db.select().from(posts).all(),
})

export const POST = defineRoute({
  body: z.object({ title: z.string().min(3) }),
  status: 201,
  handler: ({ body }) => db.insert(posts).values(body).returning().get(),
})
```

### Database (Drizzle + SQLite)
```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const posts = sqliteTable('posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  published: integer('published', { mode: 'boolean' }).notNull().default(false),
})
```

### Scaffold a Resource
```bash
npx theokit generate resource posts title:string published:boolean
# Creates: schema table + routes (CRUD) + test
```

### Validation
- **Zod is the single source of truth** — define schema once, get types + validation + OpenAPI
- `body: z.object(...)` in defineRoute validates automatically, returns 422 on failure
- Use `z.infer<typeof schema>` for TypeScript types

### Dynamic Routes
- `server/routes/posts/[id].ts` → `/api/posts/:id`
- Params validated with `params: z.object({ id: z.coerce.number() })`

### Path Aliases
- `@/*` → project root (configured in tsconfig.json)

## Commands

```bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run start        # Run production build
npm run test         # Run tests (vitest)
npm run lint         # ESLint check
npm run format       # Prettier format
npm run typecheck    # TypeScript type check
npx theokit generate resource <name> <fields...>  # Scaffold CRUD resource
npx drizzle-kit push      # Apply schema changes (dev)
npx drizzle-kit generate  # Generate migration files (prod)
```

## SDK Ecosystem

| Package | Purpose | Install separately? |
|---------|---------|-------------------|
| `theokit` | Framework (routes, SSR, client, CLI) | Already installed |
| `@theokit/sdk` | Agent runtime (Agent.create, defineTool primitive) | Already installed |
| `@theokit/sdk-tools` | Ready-made tools (readFile, writeFile, search, shell) | Yes — `npm install @theokit/sdk-tools` |
| `@theokit/agents` | Decorator surface (@Agent, @Tool, @Toolbox) | Already installed |
| `@theokit/ui` | AI chat UI components (ChatThread, ChatComposer, CodeBlock) | Yes — `npm install @theokit/ui` |
| `@theokit/di-agent` | DI-powered agent pattern | Yes — when using DI |

**Before writing custom tools, check `@theokit/sdk-tools`** — it likely has what you need.

## Don't

- Don't use `any` — use Zod schemas + `z.infer<>`
- Don't write raw `res.status().json()` — use defineRoute with status option
- Don't parse request body manually — use `body: z.object(...)` in defineRoute
- Don't import from `theokit/dist/...` or `theokit/src/...` — use public exports only
- Don't call LLM APIs directly — use @Agent + @Tool decorators
- Don't reimplement file/search/shell tools — use `@theokit/sdk-tools`
- Don't use `npm link` for `@theokit/ui` — causes dual-React; use tarball or npm registry
