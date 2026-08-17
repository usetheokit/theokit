import { route } from 'theokit/server'

/**
 * Plain GET route — no per-route rate limit needed. The framework's
 * rate limiter (configured at `theo.config.ts`) is applied uniformly
 * to /api/* routes.
 */
export const GET = route()
  .handler(() => ({ ok: true, at: new Date().toISOString() }))
  .build()
