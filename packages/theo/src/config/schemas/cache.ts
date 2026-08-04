import { z } from 'zod'

// `.finite()` foi removido dos 4 schemas numéricos abaixo (agent-builder#319): em zod 4 ele é
// no-op — `z.number()` já rejeita `Infinity`, `-Infinity` e `NaN` por padrão. Medido antes de
// remover, contra zod 4.4.3 instalado, e não presumido a partir da mensagem de depreciação:
// os cinco casos (`Infinity`, `-Infinity`, `NaN`, `1.5`, `0`) dão o MESMO veredito com e sem ele.

/**
 * Cache subsystem config (caching-and-revalidation-plan).
 * Default `cache: undefined` keeps the framework backward-compatible
 * (no engine initialized → no cache primitives available).
 *
 * Setting `cache: {}` opts in with all defaults.
 */
const routeRuleSchema = z.object({
  maxAge: z.number().nonnegative().optional(),
  swr: z.number().nonnegative().optional(),
  tags: z.array(z.string()).optional(),
})

export const cacheSchema = z.object({
  enabled: z.boolean().default(true),
  /** 'memory' uses InMemoryCacheAdapter; otherwise pass a custom adapter instance. */
  storage: z.union([z.literal('memory'), z.custom<unknown>()]).default('memory'),
  maxEntries: z.number().int().positive().default(1000),
  defaults: z
    .object({
      maxAge: z.number().nonnegative().default(1),
      swr: z.number().nonnegative().optional(),
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
