/**
 * The CORS configuration a deployed entry carries, baked at build time.
 *
 * ## The defect this closes
 *
 * `security.cors` reached exactly one consumer: Vite's `configureServer` hook. So an app that
 * worked cross-origin under `theokit dev` stopped working the moment anything else served it —
 * `theokit start` (fixed separately) and all six Web deploy targets (usetheokit/theokit#409). Same
 * config, same code, no error and no warning; the failure surfaces in a browser as a blocked fetch
 * on the deployed URL, three layers from the key that had quietly stopped being read.
 *
 * The pure half was written twice and called once: `createCorsWebHandler` — the Web mirror — had no
 * caller anywhere in the repository. Nothing here reimplements it.
 *
 * ## A callback origin is REFUSED, not silently dropped
 *
 * `corsSchema.origins` accepts `z.function(...)` alongside the string / RegExp / array shapes. A
 * deployed function has no `theo.config.ts` to read, and there is no literal for a closure — so a
 * build that baked only the serialisable shapes would produce an app whose CORS silently allowed
 * nothing, which is the exact class of failure this issue reports.
 *
 * `rules/three-target-parity.md` § 3 is explicit about the alternative: "a target that cannot serve
 * a capability refuses by name. Silent degradation is the failure mode this rule exists to
 * prevent." So the build throws, naming the target, the key and the two ways forward.
 */
import type { TheoConfig } from '../config/schema.js'

type CorsConfig = NonNullable<NonNullable<TheoConfig['security']>['cors']>

/**
 * The CORS slice of an adapter's build options.
 *
 * Narrow and named once, matching how `securityHeaders` and `DeployedCsrfOptions` already reach the
 * emitters: each renderer receives what it uses, and six signatures name one type instead of six
 * inline shapes that can drift.
 */
export interface DeployedCorsOptions {
  cors?: CorsConfig
}

/**
 * Thrown at BUILD time when the declared CORS cannot be carried to a deployed target.
 *
 * A build error is the point: the alternative is a deploy that looks configured and refuses every
 * cross-origin request, discovered by a browser rather than by the build.
 */
export class UnserializableCorsOriginError extends Error {
  constructor(target: string) {
    super(
      `security.cors.origins is a function, and the \`${target}\` target cannot carry it: a deployed ` +
        `function has no theo.config.ts to read, and a callback cannot be written into the emitted ` +
        `entry. Replace it with the origin, a RegExp, or an array of either — all of which travel — ` +
        `or build for \`node\` and run \`theokit start\`, which evaluates the callback at runtime.`,
    )
    this.name = 'UnserializableCorsOriginError'
  }
}

/** Source text for one origin matcher: a RegExp as a literal, anything else as JSON. */
function renderOrigin(origin: unknown, target: string): string {
  if (typeof origin === 'function') throw new UnserializableCorsOriginError(target)
  if (origin instanceof RegExp) return String(origin)
  if (Array.isArray(origin)) return `[${origin.map((o) => renderOrigin(o, target)).join(', ')}]`
  return JSON.stringify(origin)
}

/**
 * Source text for the CORS config, or `undefined` when the app declared none.
 *
 * RegExp entries are emitted as regex literals for the reason `deployed-csrf.ts` gives at length:
 * `JSON.stringify` renders a RegExp as `{}`, and `matchesOrigin` checks `instanceof RegExp`, so a
 * JSON-rendered origin would sit in the emitted file looking configured and matching nothing.
 *
 * @throws UnserializableCorsOriginError when `origins` is a callback
 */
export function renderDeployedCorsLiteral(cors: CorsConfig | undefined, target: string): string {
  if (cors === undefined) return 'undefined'

  const parts = [`origins: ${renderOrigin(cors.origins, target)}`]
  if (cors.methods !== undefined) parts.push(`methods: ${JSON.stringify(cors.methods)}`)
  if (cors.allowedHeaders !== undefined)
    parts.push(`allowedHeaders: ${JSON.stringify(cors.allowedHeaders)}`)
  if (cors.exposedHeaders !== undefined)
    parts.push(`exposedHeaders: ${JSON.stringify(cors.exposedHeaders)}`)
  // Both carry schema defaults, so they are always present and always emitted — unlike the
  // optional fields above, whose absence is a real answer the handler already has one for.
  parts.push(
    `credentials: ${JSON.stringify(cors.credentials)}`,
    `maxAge: ${JSON.stringify(cors.maxAge)}`,
  )

  return `{ ${parts.join(', ')} }`
}

/**
 * The lines that declare the CORS handler in a generated entry.
 *
 * `null` when nothing was declared, which is what "no cors block" meant before and still means: no
 * headers, not permissive ones.
 */
export function deployedCorsFragment(cors: CorsConfig | undefined, target: string): string[] {
  return [
    `// #409 — the CORS the app declared, carried as a literal because a deployed function has no`,
    `// theo.config.ts to read. \`null\` when the app declared none: no headers, not permissive ones.`,
    `const CORS_CONFIG = ${renderDeployedCorsLiteral(cors, target)}`,
    `const CORS_HANDLER = CORS_CONFIG === undefined ? null : createCorsWebHandler(CORS_CONFIG)`,
    ``,
    `/** Answer a preflight before routing — an OPTIONS the router handles never gets a CORS answer. */`,
    `function corsPreflight(request) {`,
    `  return CORS_HANDLER === null ? null : CORS_HANDLER.handlePreflightRequest(request)`,
    `}`,
    ``,
    `/** Put the headers on whatever the app answered, including its 404s — a browser reads a 404`,
    ` *  without them as a CORS failure rather than as the 404 it is. */`,
    `function withCors(request, response) {`,
    `  if (CORS_HANDLER !== null) CORS_HANDLER.applyCorsHeaders(request, response.headers)`,
    `  return response`,
    `}`,
  ]
}
