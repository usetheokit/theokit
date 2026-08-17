import { route } from 'theokit/server'
import { z } from 'zod'

/**
 * /api/login — strict-limited endpoint. The per-route entry in
 * `theo.config.ts.rateLimit.routes` makes this 5/min instead of the
 * default 100/min.
 */
export const POST = route()
  .body(z.object({ email: z.string().email(), password: z.string() }))
  .handler(async () => {
    // Dummy — real auth would call verifyPassword + throttleLoginAttempts.
    return { ok: true }
  })
  .build()
