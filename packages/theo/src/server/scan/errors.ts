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
      // The import is part of the remedy, not decoration. This message shipped
      // naming `requireOwner` while no entry point exported it, so it read as
      // actionable and was not. `tests/unit/policy-gate-remedy-is-importable.test.ts`
      // asserts that every symbol named here is reachable from the path named here.
      `  import { route, requireOwner } from 'theokit/server/define'`,
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

/**
 * Canonical landing page for the agent-policy migration. Module-local for the same reason as its
 * route sibling: nothing outside this file names it, and an export with no consumer is what `knip`
 * exists to refuse.
 */
const AGENT_POLICY_MIGRATION_GUIDE_URL = 'https://theokit.dev/migration/agent-policy'

interface MissingAgentPolicyErrorOptions {
  /** Absolute path of the agent file. */
  file: string
  /** The URL the agent is served at, so the message reads like the app rather than like the disk. */
  agentPath: string
  /** Migration guide URL (defaults to {@link AGENT_POLICY_MIGRATION_GUIDE_URL}). */
  migrationUrl?: string
}

/**
 * Thrown by `scanAgents` when an agent file declares no access policy
 * (ADR 0001 Decision point 5, extended to the agent surface by usetheokit/theokit#365).
 *
 * ## Why absence had to stop meaning open HERE and not at runtime
 *
 * The agent endpoints resume a conversation the CALLER names, and they are dispatched before route
 * matching, so no route, no middleware and no `server/context.ts` ever saw those URLs. A caller
 * holding a conversation id and no credential read that conversation back.
 *
 * There is no safe runtime default for that. Refusing every caller-named session id would break
 * multi-turn chat, which is the base case; admitting them is the defect. So the decision moves to
 * where a person can answer it once, in the file that owns the agent — the same place and the same
 * reasoning as the route gate, which is why this error reads like its sibling.
 *
 * ## What it costs
 *
 * Every existing application with an agent fails its next build until it adds one line. That is the
 * half of ADR 0001 the ADR itself called breaking, and the trade it names: a build error that
 * points at a file beats a silent 200 that hands over somebody else's conversation.
 */
export class MissingAgentPolicyError extends Error {
  override readonly name = 'MissingAgentPolicyError'
  readonly file: string
  readonly agentPath: string
  readonly migrationUrl: string

  constructor(opts: MissingAgentPolicyErrorOptions) {
    const migrationUrl = opts.migrationUrl ?? AGENT_POLICY_MIGRATION_GUIDE_URL
    const message = [
      `Agent policy not declared: every agent says who may run it (ADR 0001).`,
      ``,
      `  File:  ${opts.file}`,
      `  Agent: ${opts.agentPath}`,
      ``,
      `This one declaration covers every endpoint the agent exposes - the run, the`,
      `thread routes, the pending-approval listing, the approve route and MCP - because`,
      `they all reach the same conversation and the same paused tools.`,
      ``,
      `Add ONE of these to the file above:`,
      ``,
      `  export const policy = 'public'   // anyone who can reach it may run it`,
      ``,
      `  import { requireOwner } from 'theokit/server/define'`,
      ``,
      `  //  subject  <- what server/context.ts put on ctx.subject`,
      `  //  params   <- { agent, endpoint, sessionId?, approvalId? }`,
      `  //  body     <- the parsed chat body, on the endpoints that have one`,
      `  export const policy = ({ subject, params }) =>`,
      `    requireOwner(subject, ownerOf(params.sessionId))`,
      ``,
      `Writing 'public' is a decision and not a default. The endpoint resumes whatever`,
      `conversation the CALLER names, so 'public' means any caller holding an id may read`,
      `and continue that conversation - a capability model, which is legitimate when it is`,
      `the choice somebody made and greppable once it is written down.`,
      ``,
      `Migration guide: ${migrationUrl}`,
    ].join('\n')
    super(message)
    this.file = opts.file
    this.agentPath = opts.agentPath
    this.migrationUrl = migrationUrl
  }
}

interface RedundantApiSegmentErrorOptions {
  /** Absolute path of the offending route file. */
  file: string
  /** The path it resolves to today, with the doubled prefix. */
  doubledRoutePath: string
  /** Where the file belongs, relative and ready to copy. */
  suggestion: string
  /** The typed-client chain it produces today, with the redundant segment. */
  doubledClientChain: string
}

/**
 * Thrown by `scanServerRoutes` when a route file sits under `routes/api/`.
 *
 * `routes/` is already served under `/api`, so the directory doubles the prefix — and it does so
 * in two places at once, which is why this is an error rather than a lint.
 *
 * The URL is the visible half: `routes/api/auth/callback.ts` answers at `/api/api/auth/callback`,
 * which is not the redirect URI anybody registered with an identity provider. The second half
 * survives a reader's attention: `.theokit/client.d.ts` mirrors the file tree into the typed
 * client, so the same file produces `client.api.auth.callback.get()` — an `api` segment that reads
 * as a typo and is not one.
 *
 * Refusing rather than silently stripping the segment is deliberate. Collapsing would swap one
 * silent behaviour for another, and would let `routes/api/foo.ts` and `routes/foo.ts` resolve to
 * one URL — a collision needing its own error anyway.
 *
 * The `/api` prefix itself is not the defect. It is the boundary between what the server answers
 * and what the SPA answers, and three framework namespaces live under it (`/api/__actions/`,
 * `/api/agents/`, `/api/__theo_batch__`).
 */
export class RedundantApiSegmentError extends Error {
  override readonly name = 'RedundantApiSegmentError'
  readonly file: string
  readonly doubledRoutePath: string
  readonly suggestion: string

  constructor(opts: RedundantApiSegmentErrorOptions) {
    const message = [
      `Redundant 'api' directory: routes/ is already served under /api.`,
      ``,
      `  File:    ${opts.file}`,
      `  Answers: ${opts.doubledRoutePath}`,
      `  Client:  ${opts.doubledClientChain}`,
      ``,
      `Move it up one level:`,
      ``,
      `  ${opts.suggestion}`,
      ``,
      `Both halves are wrong from one cause. The URL is not the one you would register with an`,
      `identity provider or call from anywhere, and the generated typed client in`,
      `.theokit/client.d.ts carries the same redundant segment.`,
    ].join('\n')
    super(message)
    this.file = opts.file
    this.doubledRoutePath = opts.doubledRoutePath
    this.suggestion = opts.suggestion
  }
}
