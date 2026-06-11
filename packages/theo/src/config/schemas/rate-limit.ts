import { z } from 'zod'

/**
 * Base bucket config — legacy shape preserved for backwards compatibility.
 */
const baseRateLimitSchema = z.object({
  windowMs: z.number().min(1),
  max: z.number().int().min(1),
})

/**
 * T2.2 — Per-route + per-user rate limit. The new shape adds `routes`
 * (path map), `keyBy`, and `cookieName`. The legacy flat shape is still
 * accepted via the union — see `createRouteRateLimiter` for normalization.
 */
export const rateLimitSchema = z.union([
  baseRateLimitSchema,
  z.object({
    default: baseRateLimitSchema.optional(),
    routes: z.record(z.string(), baseRateLimitSchema).optional(),
    keyBy: z
      .union([
        z.enum(['ip', 'session', 'user']),
        z.function({ input: z.tuple([z.unknown()]), output: z.string() }),
      ])
      .optional(),
    cookieName: z.string().min(1).optional(),
  }),
])
