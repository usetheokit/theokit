---
name: theokit-database
description: TheoKit database — Drizzle ORM schema (SQLite or PostgreSQL), migrations, seeds, db commands
user-invocable: false
paths:
  - '**/*schema*'
  - '**/*db*'
  - '**/drizzle*'
  - '**/*migration*'
  - '**/*seed*'
---

# TheoKit Database (Drizzle)

The examples below use SQLite (`better-sqlite3`), the zero-setup default. **PostgreSQL works
differently** in three places, covered in [PostgreSQL](#postgresql): the column builders come from
`drizzle-orm/pg-core`, the connection comes from `storage` in `theo.config.ts` through
`getStorageManager().usePostgres(...)`, and every query is awaited (the Postgres drivers have no
`.all()`, `.get()` or `.run()`).

Paths below are relative to `serverDir` in `theo.config.ts` (`src/server` in a scaffolded app).

## Schema Definition

```typescript
// src/server/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
})

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
})
```

## DB Connection

```typescript
// src/server/db/index.ts
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
// src/server/db/seed.ts
import { db } from './index.js'
import { tasks } from './schema.js'

await db
  .insert(tasks)
  .values([
    { title: 'Learn TheoKit', done: false },
    { title: 'Build an agent', done: false },
  ])
  .run()

console.log('Seeded database')
```

Run: `npx theokit db seed` (runs `<serverDir>/db/seed.ts`)

## PostgreSQL

Declare the server and database in `theo.config.ts` (see the `theokit-config` skill for every
field), then build the Drizzle client on the pool the storage manager caches:

```typescript
// src/server/db/index.ts
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { getStorageManager } from 'theokit/server/storage'

import * as schema from './schema.js'

const pool = getStorageManager().usePostgres('main', (server, db) => {
  const { host, port, user, password } = server
  return new pg.Pool({ host, port, user, password, database: db.database, ...db.pool })
}) as pg.Pool

export const db = drizzle(pool, { schema })
```

```typescript
// src/server/db/schema.ts
import { boolean, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

export const tasks = pgTable('tasks', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  done: boolean('done').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
```

```typescript
// Queries return promises: await them, and take rows from `returning()`
const all = await db.select().from(tasks)
const [created] = await db.insert(tasks).values({ title: 'New task' }).returning()
await db.update(tasks).set({ done: true }).where(eq(tasks.id, 1))
```

`drizzle.config.ts` sets `dialect: 'postgresql'` and its own `dbCredentials` for `drizzle-kit`.

## CLI Commands

```bash
npx theokit db generate  # Write SQL migration files from the schema
npx theokit db migrate   # Apply the migration files (drizzle-kit migrate), recorded in a journal
npx theokit db push      # Diff the schema straight into the dev DB (no migration files)
npx theokit db seed      # Run <serverDir>/db/seed.ts
```

## Scaffolding Resources

```bash
npx theokit generate resource posts title:string published:boolean
# Needs:   <serverDir>/db/schema.ts (it appends the table there)
# Creates: <serverDir>/routes/posts/index.ts (GET + POST)
#          <serverDir>/routes/posts/[id].ts (GET + PUT + DELETE)
#          tests/posts.test.ts (smoke test)
```

The generator writes SQLite or PostgreSQL code, following `dialect` in `drizzle.config.ts` (or the
module `schema.ts` already imports from). Any other dialect is refused with nothing written.

Supported field types: `string`, `text`, `number`, `boolean`

## Anti-patterns

- NEVER use raw SQL for schema — use Drizzle's schema builder
- NEVER delete `data/dev.db` to apply changes — use `npx theokit db push`
- NEVER put DB connection logic in route files — import from `<serverDir>/db/index.ts`
- NEVER use `id`, `createdAt`, or `created_at` as field names in `generate resource` — they're auto-added
