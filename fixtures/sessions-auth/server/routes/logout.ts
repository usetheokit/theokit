import { route } from 'theokit/server'
import type { RequestContext } from '../context.js'

export const POST = route()
  .handler(({ ctx }: { ctx: RequestContext }) => {
    ctx.sessions.destroySession(ctx.res)
    return { ok: true }
  })
  .build()
