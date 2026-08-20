import { compareByCodeUnit } from '../_internal/compare-by-code-unit.js'

/**
 * Router-convention errors thrown by the server-route scanner.
 *
 *
 * theokit 0.4.0+ enforces directory-nested file-system routing
 * (`auth/[provider]/login.ts`) and REJECTS dotted-basename routes
 * (`auth.[provider].login.ts`) because the legacy regex extracted the
 * dotted basename incorrectly — `params.provider` was undefined at request
 * time. Decision recorded in the plan above (`g6-router-convention-plan.md`) and CHANGELOG 0.4.0
 * (no standalone ADR was cut for this router-convention change).
 */

/**
 * Canonical migration guide URL. T4.2 establishes this as the authoritative
 * landing page. EC-3: error message uses this constant so the URL never
 * drifts from the doc location.
 */
export const ROUTER_MIGRATION_GUIDE_URL = 'https://theokit.dev/migration/0.3-to-0.4-router'

interface RouterConventionErrorOptions {
  /** Absolute path of the offending route file. */
  file: string
  /** Suggested directory-nested replacement path (relative, e.g. `routes/auth/[provider]/login.ts`). */
  suggestion: string
  /** Migration guide URL (defaults to `ROUTER_MIGRATION_GUIDE_URL`). */
  migrationUrl?: string
}

/**
 * Thrown by `scanServerRoutes` when a route file uses the legacy
 * dotted-basename convention (`auth.[provider].login.ts`).
 *
 * The error is FAIL-FAST by design — running with a route that has wrong
 * `paramNames` produces silent 404s at request time, which is strictly
 * worse than a build-time error.
 */
export class RouterConventionError extends Error {
  override readonly name = 'RouterConventionError'
  readonly file: string
  readonly suggestion: string
  readonly migrationUrl: string

  constructor(opts: RouterConventionErrorOptions) {
    const migrationUrl = opts.migrationUrl ?? ROUTER_MIGRATION_GUIDE_URL
    const message = [
      `Router convention violation: dotted route basename is not supported in theokit 0.4+.`,
      ``,
      `  File: ${opts.file}`,
      `  Use directory-nested form: ${opts.suggestion}`,
      ``,
      `Migration guide: ${migrationUrl}`,
      `Run \`theokit migrate router\` to convert all dotted basenames automatically.`,
    ].join('\n')
    super(message)
    this.file = opts.file
    this.suggestion = opts.suggestion
    this.migrationUrl = migrationUrl
  }
}

/**
 * Canonical landing page for the policy-declaration migration. Held as a
 * constant for the same reason as {@link ROUTER_MIGRATION_GUIDE_URL}: the error
 * message and the doc cannot drift apart if only one of them names the URL.
 *
 * Module-local, unlike its sibling: nothing outside this file needs to name it,
 * and an export with no consumer is what `knip` exists to refuse.
 */
const ROUTE_POLICY_MIGRATION_GUIDE_URL = 'https://theokit.dev/migration/route-policy'

interface MissingRoutePolicyErrorOptions {
  /** Absolute path of the route file. */
  file: string
  /** The URL path the file resolves to, so the message reads like the app, not like the disk. */
  routePath: string
  /** The exported HTTP methods that declare no policy. */
  methods: string[]
  /** Migration guide URL (defaults to {@link ROUTE_POLICY_MIGRATION_GUIDE_URL}). */
  migrationUrl?: string
}

/**
 * Thrown by `scanServerRoutes` when a route file exports an HTTP method that
 * declares no access policy (ADR 0001, Decision point 5).
 *
 * Absence used to mean "not declared", which every reader and every transport
 * had to interpret as open. The interpretation was the bug: a route nobody
 * thought about looked exactly like a route deliberately left open. This error
 * is where the two stop looking alike.
 *
 * It fires at scan time — `theo build`, `theo start`, `theo dev`, `theo routes`
 * and every deployment adapter go through the same scanner — so the answer
 * arrives before a request does, in the same place the scanner already refuses
 * a dotted basename and a collision with the reserved batch path.
 */
export class MissingRoutePolicyError extends Error {
  override readonly name = 'MissingRoutePolicyError'
  readonly file: string
  readonly routePath: string
  readonly methods: string[]
  readonly migrationUrl: string

  constructor(opts: MissingRoutePolicyErrorOptions) {
    const migrationUrl = opts.migrationUrl ?? ROUTE_POLICY_MIGRATION_GUIDE_URL
    const methods = [...opts.methods].sort(compareByCodeUnit)
    const message = [
      `Route policy not declared: every route says who may call it (ADR 0001).`,
      ``,
      `  File:    ${opts.file}`,
      `  Route:   ${opts.routePath}`,
      `  Missing: ${methods.join(', ')}`,
      ``,
      `Add a policy to each method listed above:`,
      ``,
      `  export const ${methods[0] ?? 'GET'} = route()`,
      `    .policy('public')                                  // anyone may call this`,
      `    .handler(...)`,
      `    .build()`,
      ``,
      `  export const ${methods[0] ?? 'GET'} = route()`,
      `    .policy(({ subject, params }) => requireOwner(subject, ownerOf(params.id)))`,
      `    .handler(...)`,
      `    .build()`,
      ``,
      `Writing 'public' is a decision and not a default. It states that this route`,
      `is open to anyone who can reach it, and it is greppable, so how much of the`,
      `app is open becomes a number somebody can read.`,
      ``,
      `Migration guide: ${migrationUrl}`,
    ].join('\n')
    super(message)
    this.file = opts.file
    this.routePath = opts.routePath
    this.methods = methods
    this.migrationUrl = migrationUrl
  }
}
