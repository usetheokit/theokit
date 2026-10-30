---
name: theokit-config
description: TheoKit configuration — the config() builder, plugins, security, storage, agents, build targets
user-invocable: false
paths:
  - 'theo.config*'
  - '**/*config*'
---

# TheoKit Configuration

## theo.config.ts

```typescript
import { config } from 'theokit'

export default config()
  .set({
    // Basic
    name: 'my-app', // DNS-1123 format (lowercase + hyphens)
    port: 3000, // Dev + production port

    // SSR (default: false)
    ssr: false,

    // Security (defaults are secure)
    security: {
      csrf: true, // CSRF protection (default: true)
      csp: 'report-only', // Content Security Policy
    },

    // Agent runtime
    agents: {
      maxRegistries: 100,
      registry: {
        maxAgents: 100,
        idleTimeoutMs: 30 * 60_000,
      },
    },

    // DevTools overlay (dev only)
    devtools: true,

    // Plugins
    plugins: [],
  })
  .build()
```

## Common Configuration Patterns

### Adding CORS

```typescript
import { config } from 'theokit'

export default config()
  .set({
    // CORS is handled by the framework — configure in route-level or globally
    security: {
      cors: {
        origin: ['http://localhost:3000', 'https://myapp.com'],
        credentials: true,
      },
    },
  })
  .build()
```

### Storage (Postgres + Redis)

`storage` declares named servers, the Postgres databases on them and Redis servers. Credentials
are fields, not a connection string: there is no `url` key and theokit reads no `DATABASE_URL` or
`REDIS_URL`. An unknown key under `storage` fails at startup.

```typescript
export default config()
  .set({
    storage: {
      servers: {
        primary: {
          host: process.env.PGHOST ?? 'localhost',
          port: Number(process.env.PGPORT ?? 5432),
          user: process.env.PGUSER ?? 'postgres',
          password: process.env.PGPASSWORD ?? '',
        },
      },
      // `server` names a key in `servers`.
      databases: { main: { server: 'primary', database: 'app', pool: { max: 10 } } },
      // Optional. Each entry is a server record, keyed by name.
      redis: {
        cache: { host: 'localhost', port: 6379, user: 'default', password: '' },
      },
    },
  })
  .build()
```

Route code gets a cached client by name with a factory you write, so the driver stays optional:

```typescript
import pg from 'pg'
import { getStorageManager } from 'theokit/server/storage'

const pool = getStorageManager().usePostgres('main', (server, db) => {
  const { host, port, user, password } = server
  const p = new pg.Pool({ host, port, user, password, database: db.database, ...db.pool })
  p.on('error', (err) => console.warn('[pg] idle client error:', err.message))
  return p
}) as pg.Pool
```

### Rate Limiting

```typescript
export default config()
  .set({
    rateLimit: {
      global: { max: 100, windowMs: 60_000 },
    },
  })
  .build()
```

### OpenAPI Generation

```typescript
export default config()
  .set({
    openapi: {
      title: 'My App API',
      version: '1.0.0',
      outDir: '.theokit',
    },
  })
  .build()
```

## CLI Commands

```bash
npx theokit dev                    # Start dev server with HMR
npx theokit build                  # Build for Node.js
npx theokit build --target=node    # Explicit target
npx theokit start                  # Run production build
npx theokit routes                 # List all discovered endpoints
npx theokit generate route tasks   # Scaffold a new route
npx theokit generate resource posts title:string  # Scaffold CRUD resource
npx theokit db generate            # Write SQL migration files from the Drizzle schema
npx theokit db migrate             # Apply them (drizzle-kit migrate)
npx theokit db push                # Diff the schema into the database, no migration files
npx theokit db seed                # Run <serverDir>/db/seed.ts
```

## Environment Variables

- `PORT` — Server port (overrides config)
- `HOST` — Server host
- `NODE_ENV` — `development` | `production`
- theokit reads no database URL from the environment. Read whatever variables you choose
  (`PGHOST`, `PGPASSWORD`, ...) inside `storage.servers` in `theo.config.ts`.

Env vars are loaded from `.env` (dev) and `.env.production` (build). NEVER commit `.env` files.

## Anti-patterns

- NEVER hardcode secrets in theo.config.ts — use environment variables
- NEVER set `security.csrf: false` in production
- NEVER use `ssr: true` without understanding hydration (start with `false`)
- NEVER add plugins that don't match `TheoPlugin` interface
