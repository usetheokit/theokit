import type { Plugin } from 'vite'

import type { TheoConfig } from '../config/schema.js'

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
export interface AdapterBuildContext {
  makeVitePlugins?: (opts: { root: string; ssr?: boolean }) => Plugin[] | Promise<Plugin[]>
}

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
