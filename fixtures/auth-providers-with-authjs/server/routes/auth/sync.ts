import { defineRoute, rotateSession } from 'theokit/server'
import { z } from 'zod'

/**
 * POST /auth/sync — Auth.js owns the OAuth flow; after it resolves an
 * identity, the client posts the verified profile here and we mint a fresh
 * TheoKit session. Auth.js stays the source of truth for provider deltas;
 * TheoKit owns the app session.
 */
const SyncBody = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
})

export const POST = defineRoute({
  body: SyncBody,
  async handler({ body, cookies }) {
    await rotateSession(cookies, { userId: body.userId, email: body.email })
    return Response.json({ ok: true })
  },
})
