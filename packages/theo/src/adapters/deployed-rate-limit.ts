/**
 * The rate limit a deployed entry carries, baked at build time.
 *
 * ## What #508 asked for, and what this answers
 *
 * `theokit build` refuses the six Web-standards targets when `theo.config.ts` declares a
 * `rateLimit` (`UnenforceableRateLimitError`). That refusal is honest and it is not enforcement.
 * The issue names three things standing between the refusal and a working limit: per-runtime
 * caller-address resolution, a refusal that survives where the address cannot be resolved, and
 * storage that outlives one invocation.
 *
 * For `bun` all three already have answers, which is why it is the target that moves first:
 *
 * - **Address** — `Bun.serve`'s handler is `fetch(request, server)`, and `server.requestIP(request)`
 *   returns the peer address without depending on a proxy header a client could set.
 * - **Storage** — `Bun.serve` is a long-lived process. `createRateLimiterWeb`'s default
 *   `InMemoryStore` therefore behaves exactly as it does under `theokit start`, which is the
 *   deployment `node` already ships.
 * - **Refusal** — see below: every shape whose key cannot be resolved in a deployed entry throws
 *   at BUILD time rather than degrading.
 *
 * ## Why the other five are not here
 *
 * Cloudflare, AWS Lambda, Netlify and Vercel are per-invocation runtimes: an in-process counter
 * does not survive between requests, so a limiter built on one forgets. A limit that forgets is a
 * limit that does not limit — the same class of failure as the shared bucket, reached by a
 * different road. Deno Deploy evicts isolates for the same reason. Those need an external counter,
 * which is a storage design and not a wiring change, so they keep refusing by name.
 *
 * Being explicit about that boundary is the point. The failure this whole area exists to prevent is
 * a config that reads as protection while protecting nothing.
 */
import type { TheoConfig } from '../config/schema.js'

type RateLimitConfig = NonNullable<TheoConfig['rateLimit']>

/** The rate-limit slice of an adapter's build options, named once like `DeployedCorsOptions`. */
export interface DeployedRateLimitOptions {
  rateLimit?: RateLimitConfig
}

/**
 * Thrown at BUILD time when a declared rate limit cannot be carried into a deployed entry.
 *
 * Distinct from {@link UnenforceableRateLimitError}, and the distinction is not cosmetic: that one
 * means *this target enforces no limit at all*, this one means *this target enforces limits, and
 * cannot carry THIS one*. An operator reading the first looks for another target; an operator
 * reading the second changes the key.
 */
export class UnserialisableRateLimitError extends Error {
  override readonly name = 'UnserialisableRateLimitError'
  constructor(
    readonly target: string,
    readonly reason: string,
    ways: readonly string[],
  ) {
    super(
      [
        `Refusing to build for \`${target}\`: theo.config.ts declares a rate limit this target cannot carry.`,
        ``,
        `  ${reason}`,
        ``,
        `  Ways forward:`,
        ...ways.map((w) => `    • ${w}`),
        ``,
        `  This refuses rather than dropping the key, because a rate limit that silently does not`,
        `  apply looks exactly like one that does (usetheokit/theokit#461, #508).`,
      ].join('\n'),
    )
  }
}

/** The base shape every accepted config narrows to: a window, a ceiling, and an IP key. */
interface BakeableRateLimit {
  windowMs: number
  max: number
}

/**
 * Narrow a declared rate limit to what a deployed entry can actually enforce, or refuse by name.
 *
 * Accepts the base `{ windowMs, max }` and the explicit `keyBy: 'ip'`, which is what the address
 * resolution below can key. Everything else throws:
 *
 * - a **function** `keyBy` has no literal — the same wall `deployed-cors.ts` hits on a callback
 *   origin, and refused for the same reason;
 * - `keyBy: 'session' | 'user'` needs a session the deployed entry does not resolve at the point
 *   the limit runs, which is before routing;
 * - `routes` needs the matched route, decided after this check. Refusing it is honest today and is
 *   the natural next slice.
 */
export function bakeableRateLimit(
  rateLimit: RateLimitConfig | undefined,
  target: string,
): BakeableRateLimit | undefined {
  if (rateLimit === undefined) return undefined
  const cfg = rateLimit as Record<string, unknown>

  if (typeof cfg.keyBy === 'function') {
    throw new UnserialisableRateLimitError(
      target,
      '`security.rateLimit.keyBy` is a function, and a deployed entry has no literal for a closure.',
      [
        "use `keyBy: 'ip'` (the default), which this target resolves from the connection",
        'build for `node` and run `theokit start`, which can call the function',
      ],
    )
  }
  if (cfg.keyBy === 'session' || cfg.keyBy === 'user') {
    throw new UnserialisableRateLimitError(
      target,
      `\`security.rateLimit.keyBy: '${cfg.keyBy}'\` needs a resolved session, and the limit runs before routing.`,
      [
        "use `keyBy: 'ip'`, which is resolvable at that point",
        'build for `node` and run `theokit start`',
      ],
    )
  }
  if (cfg.routes !== undefined) {
    throw new UnserialisableRateLimitError(
      target,
      '`security.rateLimit.routes` needs the matched route, which is decided after the limit runs here.',
      [
        'declare a single global limit (`windowMs` + `max`)',
        'build for `node` and run `theokit start`, which applies per-route limits',
      ],
    )
  }

  const windowMs = cfg.windowMs
  const max = cfg.max
  if (typeof windowMs !== 'number' || typeof max !== 'number') return undefined
  return { windowMs, max }
}

/**
 * The generated declarations and helper for a target that keys on the connection's peer address.
 *
 * `addressExpression` is the per-runtime half the issue calls out — the one thing that genuinely
 * differs between targets. Bun passes `server`; a future Deno slice would pass its
 * `ServeHandlerInfo`. Everything else here is shared.
 *
 * Returns `[]` when nothing was declared, so an app without a limit emits no limiter at all rather
 * than an inert one.
 */
export function deployedRateLimitFragment(
  rateLimit: RateLimitConfig | undefined,
  target: string,
  addressExpression: string,
): string[] {
  const baked = bakeableRateLimit(rateLimit, target)
  if (baked === undefined) return []
  return [
    `// #508 — the limit the app declared, carried as a literal because a deployed entry has no`,
    `// theo.config.ts to read. The counter lives in this process, which outlives a request here.`,
    `const RATE_LIMIT = createRateLimiterWeb({ windowMs: ${baked.windowMs}, max: ${baked.max} })`,
    ``,
    `/**`,
    ` * The caller's address, from the connection rather than from a header.`,
    ` *`,
    ` * A header a client can set is a key a client can choose, which makes the bucket theirs to`,
    ` * split. An unresolved address falls back to one shared bucket — rare here, since that only`,
    ` * happens for a connection already gone, and the same fallback \`theokit start\` uses.`,
    ` */`,
    `function callerAddress(request, server) {`,
    `  return ${addressExpression} ?? 'unknown'`,
    `}`,
    ``,
    `/** The 429 a limited caller gets, carrying the limiter's own headers. */`,
    `function rateLimited(result) {`,
    `  return new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }), {`,
    `    status: 429,`,
    `    headers: { 'Content-Type': 'application/json', ...result.headers },`,
    `  })`,
    `}`,
  ]
}

/**
 * The check itself, as generated source, placed inside the runtime's request handler.
 *
 * Extracted for the reason `bun.ts` extracts its other fragments: the emitter is one array literal,
 * so every line the entry gains counts against `max-lines-per-function`, and this one pushed it
 * past the ceiling.
 *
 * Runs AFTER the CORS preflight and BEFORE routing: a limited caller should not reach a handler,
 * and a browser still needs its CORS answer to read the 429 as a 429 rather than as a network
 * failure.
 */
export function rateLimitCheckFragment(
  rateLimit: RateLimitConfig | undefined,
  indent: string,
): string[] {
  if (rateLimit === undefined) return []
  return [
    `${indent}const limit = RATE_LIMIT(callerAddress(request, server))`,
    `${indent}if (limit.limited) {`,
    `${indent}  return withCors(request, withSecurityHeaders(rateLimited(limit), SECURITY_HEADERS))`,
    `${indent}}`,
  ]
}
