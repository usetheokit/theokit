import { route, requireAuth } from 'theokit/server'
import type { RequestContext } from '../context.js'

/**
 * `/api/me` — protected route. Returns 401 (via AuthRequiredError) if no
 * valid session cookie is present.
 *
 * The framework's error handler converts `AuthRequiredError` (status: 401)
 * into a JSON response automatically.
 */
export const GET = route()
  .handler(({ ctx }: { ctx: RequestContext }) => {
    requireAuth(ctx.session)
    return {
      userId: ctx.session.userId,
      username: ctx.session.username,
    }
  })
  .build()
