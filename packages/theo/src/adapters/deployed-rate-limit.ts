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
 * The words that are well-formed identifiers and cannot be BOUND.
 *
 * `IDENTIFIER` answers "could this be a name?"; the emitter needs "can this be THIS name?", and the
 * two differ on exactly this set. `factory` lands as a bare binding in
 * `import { <factory> } from '<module>'`, where `import { default }` is a SyntaxError — so a config
 * naming one produces a generated entry that does not parse, and the deploy fails pointing at the
 * emitted file rather than at the line that caused it.
 *
 * `default` is the one a real config reaches by accident, because `export default createStore` is
 * the ordinary shape of the module being named. The rest are here because the cost of the list is
 * one comparison and the cost of an omission is a deploy that fails somewhere else.
 *
 * Reserved words only. `defaultStore` is a legal binding, and a substring match would refuse it —
 * an over-correction that breaks working configs to protect against a shape they do not have.
 */
const NOT_BINDABLE = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
])

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

  if (!isStoreShaped(store)) {
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

  if (typeof factory !== 'string' || !IDENTIFIER.test(factory) || NOT_BINDABLE.has(factory)) {
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

  // `options` is typed `Record<string, string | number | boolean>` and the type is erased before
  // this runs, so the declaration protects nobody: the value arrives from a config file. Three
  // measured escapes, and the third is why this is a refusal rather than a comment —
  // `JSON.stringify` throws a raw TypeError naming JSON on a BigInt and on a cycle, and on a
  // FUNCTION it throws nothing and omits the key. The option was then simply absent from the
  // emitted entry, with no diagnostic: a store configured and not configured, which is the same
  // silence this whole feature exists to remove.
  const { options } = store as Record<string, unknown>
  if (options !== undefined) {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new UnserialisableRateLimitError(
        target,
        '`security.rateLimit.store.options` must be an object of scalar values.',
        [
          "declare `options: { url: 'redis://…', retries: 3 }`",
          'omit `options` and configure the store inside the factory',
        ],
      )
    }

    const offending = Object.entries(options as Record<string, unknown>).find(
      ([, v]) => typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean',
    )
    if (offending !== undefined) {
      throw new UnserialisableRateLimitError(
        target,
        `\`security.rateLimit.store.options.${offending[0]}\` must be a string, number or boolean.`,
        [
          'declare scalars only — strings, numbers and booleans',
          'move anything else into the factory itself, which the generated entry calls at runtime',
        ],
      )
    }
  }
}

/**
 * The ONE predicate both sides read — the call emitter here and `assertBakeableStore`'s first
 * refusal. They were two, differing on arrays: this one accepted `store: []` while the refusal
 * rejected it, so the declaration threw while the call side would still have emitted `await`. The
 * build refused first, so no bad entry reached disk — and the pair exists to agree BY CONSTRUCTION
 * rather than because one check happens to run earlier.
 */
function isStoreShaped(store: unknown): boolean {
  return typeof store === 'object' && store !== null && !Array.isArray(store)
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
  /**
   * The specifier prefix this target needs — `'npm:'` on Deno Deploy, empty everywhere else.
   *
   * B-257: this function now emits its OWN import for the durable limiter, rather than relying on
   * each adapter to remember one. The previous shape had THREE sides to keep in step — the
   * declaration here, the call in `rateLimitCheckFragment`, and a per-adapter import line — and the
   * third was not joined: six adapters imported `createRateLimiterWeb` and none imported
   * `createDurableRateLimiterWeb`, so a store-carrying entry referenced a free variable and would
   * have thrown `ReferenceError` while evaluating its module body. Not at the first limited request:
   * at LOAD, taking down every route including those declaring no limit.
   *
   * `cloudflare.ts:370-373` documents that exact defect from B-027, one symbol earlier. Owning the
   * import here is what stops a fourth recurrence.
   */
  importPrefix = '',
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
    // B-262 — ONE builder, one signature, always async. The emitter used to branch here:
    // `createRateLimiterWeb` returns a value and `createDurableRateLimiterWeb` returns a Promise, so
    // the CALL SITE had to know which it got and emit `await` or not. A call site whose shape changes
    // with the config is what produced B-257's missing `await`, and `buildRateLimiter` removes the
    // decision rather than documenting it.
    `import { buildRateLimiter } from '${importPrefix}theokit/server/rate-limit'`,
    ...(baked.store === undefined
      ? [
          `const RATE_LIMIT = buildRateLimiter({ windowMs: ${baked.windowMs}, max: ${baked.max} }, undefined)`,
        ]
      : [
          // B-257 — a durable counter, named by the app. `module` and the options are JSON literals;
          // `factory` was validated against IDENTIFIER at bake time because it lands here as a bare
          // identifier and no escape can make that safe.
          //
          // The limiter's own import is emitted HERE rather than by each adapter. See `importPrefix`.
          `import { ${baked.store.factory} } from ${JSON.stringify(baked.store.module)}`,
          `const RATE_LIMIT_STORE = new ${baked.store.factory}(${JSON.stringify(baked.store.options ?? {})})`,
          `const RATE_LIMIT = buildRateLimiter(`,
          `  { windowMs: ${baked.windowMs}, max: ${baked.max} },`,
          `  RATE_LIMIT_STORE,`,
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
    // B-262 — `await` unconditionally. `buildRateLimiter` is always async, so this line no longer
    // asks what the config declared. The conditional it replaces is where B-257's defect lived:
    // a Promise read for `limited` is always `undefined`, always falsy, and every request passes.
    `${indent}const limit = await RATE_LIMIT(caller)`,
    `${indent}if (limit.limited) {`,
    `${indent}  ${refuse}`,
    `${indent}}`,
  ]
}
