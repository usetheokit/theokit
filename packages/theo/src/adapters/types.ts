import type { Plugin } from 'vite'

import type { TheoConfig } from '../config/schema.js'
import type { SecurityHeadersConfig } from '../core/contracts/security-headers.js'

import type { DeployedAgent } from './deployed-agents.js'
import type { DeployedCorsOptions } from './deployed-cors.js'
import type { DeployedCsrfOptions } from './deployed-csrf.js'
import type { DeployedRateLimitOptions } from './deployed-rate-limit.js'
import type {
  DeployedAgentsDirOptions,
  DeployedRuntimeConfigOptions,
  DeployedServerDirOptions,
} from './deployed-runtime-config.js'

/**
 * Everything a filesystem deploy entry accepts.
 *
 * `vercel`, `aws-lambda` and `deno-deploy` declared this same six-member intersection, character
 * for character. Extracted after SonarCloud's duplication gate named it among the repeated blocks
 * on a pull request — the gate measuring something real, because a member added to the set had to
 * be added in three places or the targets would silently disagree about what they accept.
 *
 * `netlify` is deliberately NOT a user: it resolves `serverDir` as a literal `resolve(cwd, 'server')`
 * rather than from configuration, so it carries no `DeployedServerDirOptions`. Widening this type to
 * cover it would let netlify accept a `serverDir` it then ignores, which is the accepted-and-ignored
 * failure this framework refuses elsewhere. That netlify cannot take one is a separate gap, not a
 * reason to lie about the type.
 */
export type DeployedEntryOptions = {
  securityHeaders?: SecurityHeadersConfig
} & DeployedAgentsDirOptions &
  DeployedCsrfOptions &
  DeployedRuntimeConfigOptions &
  DeployedServerDirOptions &
  DeployedCorsOptions &
  DeployedRateLimitOptions

/**
 * Build context injected by the CLI into adapter.build.
 *
 * - `makeVitePlugins` — optional factory provided by CLI for adapters
 *   that drive `viteBuild()` directly (currently: `nodeAdapter`).
 *   When omitted, adapters that need Vite must fail with an actionable
 *   error. This inverts the previous direct edge `adapters → vite-plugin`
 *   per ADR-0001 v3 (T1.1 of the architecture-cleanup plan).
 *
 *   The factory MAY return a Promise — `theokit build` uses
 *   `theoPluginAsync` to wire the full Plugin[] chain (actions virtual
 *   module + typed client + services + @theokit/ui auto-chain) so adapters
 *   MUST `await` the result. See `cli/commands/build.ts` for the canonical
 *   invocation.
 */
/** One server route, flattened to what an adapter can bake into an emitted entry (#369). */
export interface AdapterRoute {
  /** Path relative to the project root — both the import specifier and the executor's lookup key. */
  filePath: string
  routePath: string
  methods: readonly string[]
}

export interface AdapterBuildContext {
  /**
   * `ssrStreaming` is here because the flag decides WHICH server entry the plugin emits, and
   * without a field for it no caller could pass one. `vite-plugin/index.ts` reads
   * `options.ssrStreaming === true`, so an absent field evaluated `undefined === true` forever:
   * a project declaring `ssrStreaming: true` got the buffering entry, its server found no
   * streaming renderer to call, and every response was the fully buffered document. Measured
   * 2026-09-24 on a released build — TTFB tracked the slowest Suspense boundary (60ms delay ->
   * 73ms, 800ms -> 815ms) with a single socket arrival. Same shape as `#95`, which added the
   * three directories to this object for the same reason.
   */
  makeVitePlugins?: (opts: {
    root: string
    ssr?: boolean
    ssrStreaming?: boolean
  }) => Plugin[] | Promise<Plugin[]>
  /**
   * Scan the project's routes, INJECTED for the same reason `makeVitePlugins` is (#369).
   *
   * A Worker has no filesystem, so the Cloudflare entry has to bake its routes at build time
   * instead of scanning for them at request time. Importing the scanner here would put an
   * `adapters → server` edge in the graph — the layering inversion ADR-0001 v3 removed for
   * `vite-plugin`, and the one `adapters-may-only-depend-on-core-router-services` refuses. The CLI
   * already imports both sides, so it composes this and passes it in.
   */
  scanRoutes?: (serverDir: string) => {
    routes: AdapterRoute[]
    wsRoutes: string[]
    /**
     * The app's agents (#367). A different scan from the routes, served by a different function —
     * which is precisely why no adapter had ever heard of them and every deployed
     * `/api/agents/<name>` was a 404.
     */
    agents?: DeployedAgent[]
    /**
     * B-185 — the app's `server/context.ts`, project-relative, or `undefined` when it has none.
     *
     * A Worker has no filesystem on which to find it at request time, so a target that bakes its
     * agents bakes this too (ADR 0014) and hands the factory to the subject resolver. Decided HERE,
     * beside the agents, because this provider is the only place that holds `serverDir` — the same
     * inversion argument the `agents` field above records for #367.
     */
    contextModule?: string
  }
}

/**
 * A configuration key that a request handler applies at runtime. Build-time
 * keys are deliberately absent: a runtime cannot silently drop them.
 */
export type ConfigConcern =
  | 'rateLimit'
  | 'cors'
  | 'csrf'
  | 'disallowed'
  | 'serialization'
  | 'plugins'
  | 'securityHeaders'

export interface DeployAdapter {
  name: string
  /**
   * #382 — does the handler this adapter emits hand its runtime a response
   * whose body is still being written?
   *
   * The claim is deliberately narrow, and it is the only part we can verify
   * without a real deployment: `true` means the emitted contract carries a
   * live body (a `Response` over a `ReadableStream`, or a chunk-by-chunk drain
   * into the runtime's own writable) rather than a fully materialized string
   * or buffer. It does NOT claim the platform was observed flushing early —
   * that needs a deploy, and none of these targets has one in CI.
   *
   * Omitted means no, on purpose: a new adapter should have to state that it
   * streams, because the failure mode of the opposite default is a target
   * silently listed for something nobody exercised.
   *
   * `aws-lambda` is the one target that answers no by construction — its v2
   * result object carries `body` as a string, so the response cannot exist
   * before the run ends. Making it stream means `awslambda.streamifyResponse`
   * plus a Function URL in `RESPONSE_STREAM` invoke mode, which this adapter
   * does not emit and which would break every API Gateway deployment of it.
   */
  streamsResponses?: boolean
  /**
   * Which configuration keys the handler this adapter emits actually applies.
   *
   * Same contract as `streamsResponses`, for the same reason: omitted means
   * **none**, on purpose. A new adapter should have to state what it honours,
   * because the failure mode of the opposite default is a target that parses a
   * rate limit, validates it, and refuses nothing — with no line anywhere
   * saying so.
   *
   * `'runtime-not-emitted-here'` is a third answer, not a synonym for none: it
   * belongs to an adapter that emits no request handler at all, so this build
   * genuinely cannot say what the runtime applies. Reporting such a target as
   * dropping configuration would be asserting rather than measuring.
   *
   * The declaration is a claim, and nothing here can verify it — a wrong claim
   * reads exactly like a right one. What it buys is that dropping a concern
   * becomes a visible edit instead of an omission.
   */
  /**
   * #367 — can the handler this adapter emits serve an AGENT?
   *
   * Same contract as `streamsResponses` and `appliesConfig`, for the same reason: omitted means
   * **no**, on purpose. The gap this answers went unnoticed because nothing in this layer had ever
   * heard of agents — `grep -rc "agent"` over the 14 adapter files returned nothing — so an agent
   * was served by no pipeline at all outside a machine running `theokit start`, in a framework
   * whose stated reason to exist is that the agent ships through the same pipeline as the page.
   *
   * `true` claims the emitted entry routes `/api/agents/<name>` to `mountAgent`. It is a claim
   * nothing here can verify, exactly like the other two; what it buys is that a target which drops
   * agents has to say so rather than be silently assumed to serve them.
   */
  servesAgents?: boolean
  appliesConfig?: readonly ConfigConcern[] | 'runtime-not-emitted-here'

  /**
   * B-257 — can the emitted entry ENFORCE a declared rate limit, and under what condition?
   *
   * Separate from `appliesConfig` because the two answer different questions and one list could not
   * carry both. `findUnappliedConfig` reads the first to WARN; `assertRateLimitEnforceable` reads
   * this one to REFUSE. Welded, adding `'rateLimit'` to stop a warning also satisfied
   * `applied.includes('rateLimit')` and returned before the throw — switching the refusal off on a
   * runtime where the limit still cannot hold. `config-support.ts:213-215` wrote that refusal
   * because "`rateLimit` is the one whose absence looks exactly like success".
   *
   * `'always'`            a long-lived process; the in-process counter survives between requests.
   * `'never'`             this adapter emits no request handler that could enforce anything. A
   *                       TRUE claim, unlike the abstain below: nothing answers for a static
   *                       export at runtime, so there is no other runtime to defer to.
   * `'with-a-store'`      a per-invocation or per-isolate runtime. It enforces only when the config
   *                       names a durable store, because an in-process counter there forgets, and a
   *                       limit that forgets is a limit that does not limit.
   * `'not-ours-to-judge'` this adapter emits no request handler OF ITS OWN, and another runtime
   *                       answers for it. An ABSTAIN: `config-support.ts:105-108` calls that "a
   *                       different fact from saying no", and refusing there would assert something
   *                       unmeasured about somebody else's runtime.
   *
   * **Omitted REFUSES**, and it does not abstain. Abstaining is a claim about another runtime, and a
   * claim is made rather than inferred from silence. The first cut defaulted to the abstain and
   * inverted the rule it replaced: `appliesConfig ?? []` refused an adapter that declared nothing,
   * while `?? 'not-ours-to-judge'` let it through. Measured on `static.ts`, which declares neither
   * field and is registered — it went from refusing a declared limit to proceeding with a warning.
   * This member is on the EXPORTED interface, so every third-party adapter inherited that inversion.
   */
  enforcesRateLimit?: 'always' | 'never' | 'with-a-store' | 'not-ours-to-judge'
  build(config: TheoConfig, cwd: string, ctx?: AdapterBuildContext): Promise<void>
}

export type BuildTarget =
  | 'node'
  | 'vercel'
  | 'cloudflare'
  | 'static'
  | 'bun'
  | 'deno-deploy'
  | 'netlify'
  | 'aws-lambda'
  | 'theo-cloud'

export const VALID_TARGETS: BuildTarget[] = [
  'node',
  'vercel',
  'cloudflare',
  'static',
  'bun',
  'deno-deploy',
  'netlify',
  'aws-lambda',
  'theo-cloud',
]
