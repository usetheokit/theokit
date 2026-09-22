import { z } from 'zod'

/**
 * Base bucket config — legacy shape preserved for backwards compatibility.
 */
const baseRateLimitSchema = z.object({
  windowMs: z.number().min(1),
  max: z.number().int().min(1),
})

/**
 * B-257 — the durable counter a deployment brings, in the form a generated entry can construct.
 *
 * A reference, never an instance: the entry is generated SOURCE, so whatever is named here has to
 * survive being written into a file. `factory` is the field that cannot be escaped — it lands as a
 * bare identifier in `import { <factory> }` — and `adapters/deployed-rate-limit.ts` validates it
 * there rather than here, because the refusal must name the TARGET being built.
 *
 * The framework ships no store. `server/rate-limit/rate-limit-store.ts:5-7` names Redis and
 * Cloudflare KV as what a deployment opts into, and `docs/adr/0017` states why the framework picks
 * none for anybody.
 */
const rateLimitStoreSchema = z.object({
  /** The specifier the generated entry imports from, e.g. `@upstash/redis`. */
  module: z.string().min(1),
  /** The exported name it constructs. Must be a plain identifier — see the build-time refusal. */
  factory: z.string().min(1),
  /** Constructor options, written into the entry as a JSON literal. */
  options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
})

/**
 * T2.2 — Per-route + per-user rate limit. The new shape adds `routes`
 * (path map), `keyBy`, and `cookieName`. The legacy flat shape is still
 * accepted via the union — see `createRouteRateLimiter` for normalization.
 */
export const rateLimitSchema = z.union([
  // B-257 — `store` is declared on BOTH branches. `z.object` STRIPS unknown keys, so a config
  // carrying a store matched the base branch, lost it silently, and the build then refused the
  // target with the pre-B-257 message while the operator had done exactly what the feature asks.
  // Measured before the fix: `theoConfigSchema.parse` returned `{windowMs, max}` from a config
  // whose store block was present.
  baseRateLimitSchema.extend({ store: rateLimitStoreSchema.optional() }),
  z.object({
    store: rateLimitStoreSchema.optional(),
    default: baseRateLimitSchema.optional(),
    routes: z.record(z.string(), baseRateLimitSchema).optional(),
    keyBy: z
      .union([
        z.enum(['ip', 'session', 'user']),
        z.function({ input: z.tuple([z.unknown()]), output: z.string() }),
      ])
      .optional(),
    cookieName: z.string().min(1).optional(),
    /**
     * How many reverse proxies sit in front of the app, for `keyBy: 'ip'`. `false` (default)
     * trusts none; `true` means one; a number names a longer chain.
     *
     * Required for correct limiting behind Caddy/nginx/a load balancer — without it every visitor
     * keys on the proxy address and shares a single bucket. Off by default because
     * `x-forwarded-for` is client-writable.
     */
    trustProxy: z.union([z.boolean(), z.number().int().min(0)]).optional(),
  }),
])
