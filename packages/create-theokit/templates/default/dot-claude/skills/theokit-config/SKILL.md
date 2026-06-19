---
name: theokit-config
description: TheoKit configuration — defineConfig, plugins, security, storage, agents, build targets
user-invocable: false
paths:
  - "theo.config*"
  - "**/*config*"
---

# TheoKit Configuration

## theo.config.ts

```typescript
import { defineConfig } from 'theokit'

export default defineConfig({
  // Basic
  name: 'my-app',            // DNS-1123 format (lowercase + hyphens)
  port: 3000,                // Dev + production port

  // SSR (default: false)
  ssr: false,

  // Security (defaults are secure)
  security: {
    csrf: true,               // CSRF protection (default: true)
    csp: 'report-only',       // Content Security Policy
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
```

## Common Configuration Patterns

### Adding CORS

```typescript
import { defineConfig } from 'theokit'

export default defineConfig({
  // CORS is handled by the framework — configure in route-level or globally
  security: {
    cors: {
      origin: ['http://localhost:3000', 'https://myapp.com'],
      credentials: true,
    },
  },
})
```

### Storage (Postgres + Redis)

```typescript
export default defineConfig({
  storage: {
    postgres: [{ url: process.env.DATABASE_URL }],
    redis: [{ url: process.env.REDIS_URL }],
  },
})
```

### Rate Limiting

```typescript
export default defineConfig({
  rateLimit: {
    global: { max: 100, windowMs: 60_000 },
  },
})
```

### OpenAPI Generation

```typescript
export default defineConfig({
  openapi: {
    title: 'My App API',
    version: '1.0.0',
    outDir: 'docs/api',
  },
})
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
npx theokit db migrate             # Run database migrations
npx theokit db seed                # Seed database
```

## Environment Variables

- `PORT` — Server port (overrides config)
- `HOST` — Server host
- `NODE_ENV` — `development` | `production`
- `DATABASE_URL` — Postgres connection string (when using postgres storage)
- `REDIS_URL` — Redis connection string (when using redis storage)

Env vars are loaded from `.env` (dev) and `.env.production` (build). NEVER commit `.env` files.

## Anti-patterns

- NEVER hardcode secrets in theo.config.ts — use environment variables
- NEVER set `security.csrf: false` in production
- NEVER use `ssr: true` without understanding hydration (start with `false`)
- NEVER add plugins that don't match `defineTheoPlugin` interface
