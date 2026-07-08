import { route } from 'theokit/server'
import { z } from 'zod'
import type { RequestContext } from '../context.js'

/**
 * Demo login — DO NOT USE IN PRODUCTION.
 *
 * Accepts any non-empty username/password. Replace with a real password
 * hash comparison (e.g., bcrypt) against your user table.
 */
export const POST = route()
  .body(
    z.object({
      username: z.string().min(1),
      password: z.string().min(1),
    }),
  )
  .handler(
    async ({
      body,
      ctx,
    }: {
      body: { username: string; password: string }
      ctx: RequestContext
    }) => {
      // demo only — any password works
      await ctx.sessions.createSession(ctx.res, {
        userId: `u-${body.username}`,
        username: body.username,
      })
      return { ok: true, username: body.username }
    },
  )
  .build()
