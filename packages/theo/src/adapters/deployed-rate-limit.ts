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
  /**
   * How many proxies sit in front of the app, for the forwarded-header path. Dropped before the
   * entry until B-027: the schema declares it (`config/schemas/rate-limit.ts:36`) and the generated
   * code could not honour it, so a deployment behind a proxy keyed every visitor on the proxy.
   */
  trustProxy: boolean | number
  /**
   * B-257 — the durable counter the entry constructs, or `undefined` for the in-process default.
   *
   * A reference rather than an instance: this is baked into a generated file, so it must survive
   * being written as source. `factory` is the one field that cannot be escaped — see
   * `bakeableStore` below.
   */
  store?: BakeableStore
}

/** A durable store named by `theo.config.ts`, in the form a generated entry can construct. */
interface BakeableStore {
  /** The specifier the entry imports from. Written through `JSON.stringify`. */
  module: string
  /** The exported name it constructs. VALIDATED, never escaped — it becomes a bare identifier. */
  factory: string
  /** Constructor options. Written through `JSON.stringify`. */
  options?: Record<string, string | number | boolean>
}

/**
 * A JavaScript identifier, and nothing else.
 *
 * `factory` becomes a bare identifier in `import { <factory> } from …`, where `JSON.stringify` would
 * emit `import { "x" }` and not parse. So it cannot be escaped — only validated. Without this, a
 * `theo.config.ts` carrying `factory: "x } from 'evil'; //"` writes arbitrary code into every
 * generated entry, and that file usually arrives with the clone.
 */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/**
 * Refuse a `store` a generated entry could not construct — or could construct into a hole.
 *
 * Extracted from `bakeableRateLimit` because it is its own responsibility and because inlining it
 * took that function to a cyclomatic complexity of 18 against a ceiling of 15. The three refusals
 * are one question asked of three fields, which is the shape SRP asks for.
 *
 * The third is the one that cannot be solved by escaping. `module` and `options` are written through
 * `JSON.stringify`, as `trustProxy` already is at the emit site. `factory` lands as a BARE
 * IDENTIFIER in `import { <factory> } from …`, where a quoted string does not parse — so it is
 * validated, and a config that fails the check is refused by name rather than interpolated raw.
 */
function assertBakeableStore(store: unknown, target: string): void {
  if (store === undefined) return

  if (typeof store !== 'object' || store === null || Array.isArray(store)) {
    throw new UnserialisableRateLimitError(
      target,
      '`security.rateLimit.store` must be an object naming a module and a factory.',
      [
        "declare `store: { module: '@upstash/redis', factory: 'Redis' }`",
        'omit `store` and let the build refuse this target, which is honest about not limiting',
      ],
    )
  }

  const { module: mod, factory } = store as Record<string, unknown>

  if (typeof mod !== 'string' || mod.length === 0) {
    throw new UnserialisableRateLimitError(
      target,
      '`security.rateLimit.store.module` must be the specifier the entry imports from.',
      ["declare `module: '@upstash/redis'`", 'omit `store`'],
    )
  }

  if (typeof factory !== 'string' || !IDENTIFIER.test(factory)) {
    throw new UnserialisableRateLimitError(
      target,
      '`security.rateLimit.store.factory` must be a plain identifier — it is written into the ' +
        'generated entry as `import { <factory> }`, where a quoted string would not parse, so it ' +
        'is validated rather than escaped. Anything else would put arbitrary source in every ' +
        'deployment this config builds.',
      [
        "name the export directly: `factory: 'Redis'`",
        'omit `store` and let the build refuse this target',
      ],
    )
  }
}

/**
 * Does this config name a durable store?
 *
 * **The call side and the declaration side must branch on ONE fact**, or the entry declares
 * `createDurableRateLimiterWeb` and calls it without `await` — a promise compared against a budget,
 * which never limits and never errors. The PLAN panel found the first draft naming only the
 * declaration emitter: `deployedRateLimitFragment` writes `const RATE_LIMIT = …` and
 * `rateLimitCheckFragment` writes `const limit = RATE_LIMIT(caller)`. They are a pair or they are a
 * defect.
 *
 * It reads the config rather than re-running `bakeableRateLimit`, which would re-run the refusals
 * against a target this function does not receive.
 */
function declaresDurableStore(rateLimit: RateLimitConfig | undefined): boolean {
  const store = (rateLimit as { store?: unknown } | undefined)?.store
  return typeof store === 'object' && store !== null
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
function bakeableRateLimit(
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
  assertBakeableStore(cfg.store, target)

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
  // `?? false` and not `|| false`: `trustProxy: 0` is a number and falsy, and it means the same to
  // the resolver as `false` — but emitting `false` where the operator wrote `0` makes the generated
  // entry disagree with the config a reader compares it against.
  const trustProxy = cfg.trustProxy
  return {
    windowMs,
    max,
    trustProxy:
      typeof trustProxy === 'boolean' || typeof trustProxy === 'number' ? trustProxy : false,
    // Validated above — `module` and `options` are escaped at emit time, `factory` was checked
    // against IDENTIFIER because it cannot be.
    store: cfg.store as BakeableStore | undefined,
  }
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
  /**
   * The parameter list `callerAddress` is DECLARED with, because the runtime source differs per
   * target and only `bun` binds these two names (`bun.ts:158`). `cloudflare.ts:452` binds
   * `(request, env, ctx)`, `vercel.ts:39` `(nodeReq, nodeRes)`, `netlify.ts:84` `(request, context)`,
   * `deno-deploy.ts:90` `(request)` and `aws-lambda.ts:152` `(event)`. An expression naming
   * `context`, `info`, `event` or `nodeReq` inside a function declared `(request, server)` is an
   * unbound identifier, and the entry throws on the first limited request.
   */
  params = 'request, server',
): string[] {
  const baked = bakeableRateLimit(rateLimit, target)
  if (baked === undefined) return []
  return [
    `// #508 — the limit the app declared, carried as a literal because a deployed entry has no`,
    `// theo.config.ts to read.`,
    `//`,
    `// WHERE THIS COUNTER LIVES, and it is not the same answer per target. On a long-lived server`,
    `// (\`bun\`) the process outlives a request and the count holds. On a per-invocation or`,
    `// per-isolate runtime — Cloudflare, AWS Lambda, Netlify, Vercel, Deno Deploy — it does not:`,
    `// the limit is PER INSTANCE, and a caller spread across instances gets that many budgets.`,
    `// The address is resolved correctly either way; the counting is what B-257 is about, and`,
    `// \`theokit build\` refuses a declared limit on those five until it is.`,
    ...(baked.store === undefined
      ? [
          `const RATE_LIMIT = createRateLimiterWeb({ windowMs: ${baked.windowMs}, max: ${baked.max} })`,
        ]
      : [
          // B-257 — a durable counter, named by the app. `module` and the options are JSON literals;
          // `factory` was validated against IDENTIFIER at bake time because it lands here as a bare
          // identifier and no escape can make that safe.
          `import { ${baked.store.factory} } from ${JSON.stringify(baked.store.module)}`,
          `const RATE_LIMIT_STORE = new ${baked.store.factory}(${JSON.stringify(baked.store.options ?? {})})`,
          `const RATE_LIMIT = createDurableRateLimiterWeb(`,
          `  { windowMs: ${baked.windowMs}, max: ${baked.max} },`,
          `  { store: RATE_LIMIT_STORE },`,
          `)`,
        ]),
    ``,
    `// How many proxies the deployment declared in front of it. \`client-ip.ts\` reads a forwarded`,
    `// header only when this says one wrote it: the header is whatever the client typed, so`,
    `// trusting it unasked lets anyone rotate a forged value past the limiter with one \`curl -H\`.`,
    `const TRUST_PROXY = ${JSON.stringify(baked.trustProxy)}`,
    ``,
    `/**`,
    ` * The caller's address, from the connection rather than from a header.`,
    ` *`,
    ` * A header a client can set is a key a client can choose, which makes the bucket theirs to`,
    ` * split. An address this runtime cannot resolve returns \`undefined\`, and the caller answers`,
    ` * 503 rather than keying on a constant: one shared bucket is a budget the first caller each`,
    ` * window exhausts for everyone, which is worse than no limiting at all.`,
    ` */`,
    `const addr = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)`,
    `function callerAddress(${params}) {`,
    `  return addr(${addressExpression})`,
    `}`,
    ``,
    `/** The 503 a caller this runtime cannot name gets, instead of everyone's shared bucket. */`,
    `function unnamedCaller() {`,
    `  return new Response(`,
    `    JSON.stringify({ error: { code: 'CALLER_UNRESOLVED', message: ${JSON.stringify(
      `${target} could not resolve the caller's address, and a rate limit keyed on a constant is a denial of service`,
    )} } }),`,
    `    { status: 503, headers: { 'Content-Type': 'application/json' } },`,
    `  )`,
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
  /** The arguments `callerAddress` is CALLED with — see `deployedRateLimitFragment`'s `params`. */
  args = 'request, server',
  /** How this target answers a caller over its budget. Only `bun` can use the default. */
  refuse = 'return withCors(request, withSecurityHeaders(rateLimited(limit), SECURITY_HEADERS))',
  /** How it answers a caller it could not name. Same shape, different body. */
  refuseUnnamed = 'return withCors(request, withSecurityHeaders(unnamedCaller(), SECURITY_HEADERS))',
): string[] {
  if (rateLimit === undefined) return []
  return [
    `${indent}const caller = callerAddress(${args})`,
    `${indent}if (caller === undefined) {`,
    `${indent}  ${refuseUnnamed}`,
    `${indent}}`,
    // B-257 — the call side of the pair. `deployedRateLimitFragment` emits the DECLARATION; this
    // emits the CALL, and the two branch on the same fact or the entry names a symbol it never
    // declared. A durable limiter returns a promise; the sync facade does not.
    `${indent}const limit = ${declaresDurableStore(rateLimit) ? 'await ' : ''}RATE_LIMIT(caller)`,
    `${indent}if (limit.limited) {`,
    `${indent}  ${refuse}`,
    `${indent}}`,
  ]
}
