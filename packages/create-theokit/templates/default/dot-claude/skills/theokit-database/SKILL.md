---
name: theokit-database
description: TheoKit database — Drizzle ORM, SQLite schema, migrations, seeds, db commands
user-invocable: false
paths:
  - "**/*schema*"
  - "**/*db*"
  - "**/drizzle*"
  - "**/*migration*"
  - "**/*seed*"
---

# TheoKit Database (Drizzle + SQLite)

## Schema Definition

```typescript
// server/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
})

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
})
```

## DB Connection

```typescript
// server/db/index.ts
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import * as schema from './schema.js'

const sqlite = new Database('data/dev.db')
export const db = drizzle(sqlite, { schema })
```

## Common Queries

```typescript
import { db } from '@/server/db'
import { tasks } from '@/server/db/schema'
import { eq } from 'drizzle-orm'

// Select all
db.select().from(tasks).all()

// Select by ID
db.select().from(tasks).where(eq(tasks.id, 1)).get()

// Insert + return
db.insert(tasks).values({ title: 'New task' }).returning().get()

// Update
db.update(tasks).set({ done: true }).where(eq(tasks.id, 1)).run()

// Delete
db.delete(tasks).where(eq(tasks.id, 1)).run()
```

## Seeds

```typescript
// server/db/seed.ts
import { db } from './index.js'
import { tasks } from './schema.js'

await db.insert(tasks).values([
  { title: 'Learn TheoKit', done: false },
  { title: 'Build an agent', done: false },
]).run()

console.log('Seeded database')
```

Run: `npm run seed` or `npx tsx server/db/seed.ts`

## CLI Commands

```bash
npx drizzle-kit push    # Apply schema changes to dev DB (no migration files)
npx drizzle-kit generate # Generate SQL migration files (for production)
npm run seed             # Run seed script
```

## Scaffolding Resources

```bash
npx theokit generate resource posts title:string published:boolean
# Creates: server/db/schema.ts (appends table)
#          server/routes/posts/index.ts (GET + POST)
#          server/routes/posts/[id].ts (GET + PUT + DELETE)
#          tests/posts.test.ts (smoke test)
```

Supported field types: `string`, `text`, `number`, `boolean`

## Anti-patterns

- NEVER use raw SQL for schema — use Drizzle's schema builder
- NEVER delete `data/dev.db` to apply changes — use `npx drizzle-kit push`
- NEVER put DB connection logic in route files — import from `server/db/index.ts`
- NEVER use `id`, `createdAt`, or `created_at` as field names in `generate resource` — they're auto-added
