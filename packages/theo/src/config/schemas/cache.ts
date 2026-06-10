import { z } from 'zod'

/**
 * Cache subsystem config (caching-and-revalidation-plan).
 * Default `cache: undefined` keeps the framework backward-compatible
 * (no engine initialized → no cache primitives available).
 *
 * Setting `cache: {}` opts in with all defaults.
 */
const routeRuleSchema = z.object({
  maxAge: z.number().nonnegative().finite().optional(),
  swr: z.number().nonnegative().finite().optional(),
  tags: z.array(z.string()).optional(),
})

export const cacheSchema = z.object({
  enabled: z.boolean().default(true),
  /** 'memory' uses InMemoryCacheAdapter; otherwise pass a custom adapter instance. */
  storage: z.union([z.literal('memory'), z.custom<unknown>()]).default('memory'),
  maxEntries: z.number().int().positive().default(1000),
  defaults: z
    .object({
      maxAge: z.number().nonnegative().finite().default(1),
      swr: z.number().nonnegative().finite().optional(),
      cacheErrors: z.boolean().default(false),
    })
    .default({ maxAge: 1, cacheErrors: false }),
  keyDerivation: z
    .object({
      excludeQuery: z.array(z.string()).optional(),
      sortQuery: z.boolean().default(true),
      lowercaseHost: z.boolean().default(true),
    })
    .default({ sortQuery: true, lowercaseHost: true }),
  routeRules: z.record(z.string(), routeRuleSchema).optional(),
})
