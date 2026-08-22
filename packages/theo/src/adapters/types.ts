import type { Plugin } from 'vite'

import type { TheoConfig } from '../config/schema.js'

import type { DeployedAgent } from './deployed-agents.js'

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
  makeVitePlugins?: (opts: { root: string; ssr?: boolean }) => Plugin[] | Promise<Plugin[]>
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
