/**
 * Router-convention errors thrown by the server-route scanner.
 *
 * Plan: .claude/knowledge-base/plans/g6-router-convention-plan.md v1.1
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
