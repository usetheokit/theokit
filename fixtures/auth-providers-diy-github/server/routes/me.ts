import { route } from 'theokit/server'

/** GET /me — return the current session's user, or 401. */
export const GET = route()
  .handler(({ ctx }) => {
    if (!ctx.session) return new Response('Unauthenticated', { status: 401 })
    return Response.json({ user: ctx.session })
  })
  .build()
