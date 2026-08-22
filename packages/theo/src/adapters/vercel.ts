/* eslint-disable security/detect-non-literal-fs-filename --
 * Vercel deploy adapter. All paths derived from `cwd` and a fixed
 * `.theokit/vercel/` output layout. Build-time tool — no HTTP input.
 */
import { existsSync, mkdirSync, writeFileSync, cpSync } from 'node:fs'
import { resolve } from 'node:path'

import type { TheoConfig } from '../config/schema.js'
import type { SecurityHeadersConfig } from '../core/contracts/security-headers.js'
import { assertServicesUnsupported, readManifest } from '../services/index.js'

import { deployedCorsFragment, type DeployedCorsOptions } from './deployed-cors.js'
import { deployedCsrfFragment, type DeployedCsrfOptions } from './deployed-csrf.js'
import {
  deployedRuntimeConfigFragment,
  type DeployedRuntimeConfigOptions,
} from './deployed-runtime-config.js'
import { deployedTraceFragment } from './deployed-trace.js'
import { nodeAdapter } from './node.js'
import {
  buildSecurityHeaders,
  describeDeployedSecurityHeaders,
  renderSecurityHeadersConfigLiteral,
} from './security-headers.js'
import type { AdapterBuildContext, DeployAdapter } from './types.js'

/**
 * T2.2 — Vercel adapter rewritten to consume `theokit/adapters/web-shim`
 * instead of emitting an inline plain-object Request/Response shim and
 * lazy-importing internal `theo-server/` paths.
 */

// Generated-code fragments — extracted so the parent emitter stays under the
// max-lines-per-function ceiling.
/** The exported function Vercel invokes: one security-header call, then the drain. */
function vercelHandlerFragment(): string[] {
  return [
    `export default async function handler(nodeReq, nodeRes) {`,
    `  // #409 — CORS reads only the method and the \`origin\` / \`access-control-request-method\``,
    `  // headers, so this carries exactly those and no body. It is deliberately NOT the routing`,
    `  // Request: that one drains the request stream, and only after a route matched — building it`,
    `  // here would drain the body of every static path too.`,
    `  const corsHeaders = new Headers()`,
    `  for (const [k, v] of Object.entries(nodeReq.headers ?? {})) {`,
    `    if (typeof v === 'string') corsHeaders.set(k, v)`,
    `  }`,
    `  const corsRequest = new Request(`,
    `    new URL(nodeReq.url ?? '/', 'http://' + (nodeReq.headers?.host ?? 'localhost')),`,
    `    { method: (nodeReq.method ?? 'GET').toUpperCase(), headers: corsHeaders },`,
    `  )`,
    ``,
    `  // The preflight is answered BEFORE anything routes: an OPTIONS the router handles is an`,
    `  // OPTIONS the browser never gets a CORS answer to.`,
    `  const preflight = corsPreflight(corsRequest)`,
    `  const webResponse = preflight !== null`,
    `    ? withSecurityHeaders(preflight, SECURITY_HEADERS)`,
    `    : withCors(corsRequest, withSecurityHeaders(await routeRequest(nodeReq), SECURITY_HEADERS))`,
    ``,
    `  // \`outHeaders\`, not \`headers\`: this used to live in the same scope as the`,
    `  // request-side \`const headers\` below, which made the whole module a`,
    `  // SyntaxError — every Vercel build between #382 and #411 emitted a function`,
    `  // that could not be loaded.`,
    `  const outHeaders = {}`,
    `  webResponse.headers.forEach((v, k) => { outHeaders[k] = v })`,
    `  nodeRes.writeHead(webResponse.status, outHeaders)`,
    `  if (typeof nodeRes.flushHeaders === 'function') nodeRes.flushHeaders()`,
    ``,
    `  // #382 — this used to materialize the entire body as a string and hand`,
    `  // it to a single end(), which re-buffered the whole response inside the`,
    `  // function even after the shim was fixed. Drain chunk by chunk instead,`,
    `  // honouring Node backpressure so a slow client cannot grow the queue.`,
    `  if (webResponse.body === null) {`,
    `    nodeRes.end()`,
    `    return`,
    `  }`,
    `  const reader = webResponse.body.getReader()`,
    `  try {`,
    `    for (;;) {`,
    `      const { done, value } = await reader.read()`,
    `      if (done) break`,
    `      if (nodeRes.write(value) === false) {`,
    `        await new Promise((resolveDrain) => {`,
    `          const finish = () => {`,
    `            nodeRes.off('drain', finish)`,
    `            nodeRes.off('close', finish)`,
    `            nodeRes.off('error', finish)`,
    `            resolveDrain()`,
    `          }`,
    `          nodeRes.once('drain', finish)`,
    `          nodeRes.once('close', finish)`,
    `          nodeRes.once('error', finish)`,
    `        })`,
    `      }`,
    `    }`,
    `    nodeRes.end()`,
    `  } catch (streamErr) {`,
    `    // The handler failed after the head went out. Destroying the socket is`,
    `    // the only signal left that the body is incomplete — ending normally`,
    `    // would report a truncated response as a complete one (ADR-0002).`,
    `    nodeRes.destroy(streamErr)`,
    `  } finally {`,
    `    reader.releaseLock()`,
    `  }`,
    `}`,
    ``,
  ]
}

// Generated-code fragments — extracted so the parent emitter stays under the
// max-lines-per-function ceiling.
/** Everything that decides WHAT the response is, as a Web Response for every outcome. */
function vercelRouteRequestFragment(runtimeSpread: string): string[] {
  return [
    `async function routeRequest(nodeReq) {`,
    `  const url = new URL(nodeReq.url ?? '/', 'http://' + (nodeReq.headers?.host ?? 'localhost'))`,
    ``,
    `  if (!url.pathname.startsWith('/api/')) {`,
    `    return new Response('Not Found', {`,
    `      status: 404,`,
    `      headers: { 'content-type': 'text/plain; charset=utf-8' },`,
    `    })`,
    `  }`,
    ``,
    `  if (!routesCache) routesCache = scanServerRoutes(serverDir)`,
    `  if (!loaderCache) loaderCache = createProductionLoader()`,
    ``,
    `  const match = matchRoute(url.pathname, routesCache)`,
    `  if (!match) {`,
    `    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), {`,
    `      status: 404,`,
    `      headers: { 'content-type': 'application/json' },`,
    `    })`,
    `  }`,
    ``,
    `  // Convert Node-style req to Web Request for the shim`,
    `  const headers = new Headers()`,
    `  for (const [k, v] of Object.entries(nodeReq.headers ?? {})) {`,
    `    if (typeof v === 'string') headers.set(k, v)`,
    `  }`,
    `  let body`,
    `  const method = (nodeReq.method ?? 'GET').toUpperCase()`,
    `  if (method !== 'GET' && method !== 'HEAD') {`,
    `    const chunks = []`,
    `    await new Promise((resolveProm, rejectProm) => {`,
    `      nodeReq.on('data', (c) => chunks.push(c))`,
    `      nodeReq.on('end', () => resolveProm())`,
    `      nodeReq.on('error', rejectProm)`,
    `    })`,
    `    body = Buffer.concat(chunks)`,
    `  }`,
    `  const webRequest = new Request(url.toString(), { method, headers, body })`,
    ``,
    `  const { req, res, toResponse } = createWebShim(webRequest)`,
    ...deployedTraceFragment('webRequest', '  '),
    `  // #382 — executeRoute() is NOT awaited before the Response is taken:`,
    `  // toResponse() settles at the headers and carries a live body.`,
    `  return toResponse(executeRoute({`,
    `    route: match.route, method, params: match.params,`,
    `    req, res, loadModule: loaderCache, serverDir, requestId, ...CSRF_CONFIG, ${runtimeSpread}`,
    `  }))`,
    `}`,
  ]
}

export function renderVercelFunctionEntry(
  opts: { securityHeaders?: SecurityHeadersConfig } & DeployedCsrfOptions &
    DeployedRuntimeConfigOptions &
    DeployedCorsOptions = {},
): string {
  const runtimeConfig = deployedRuntimeConfigFragment(opts)
  return [
    `// Generated by Theo — Vercel Functions adapter`,
    `// Environment variables are resolved at RUNTIME, not build time.`,
    ``,
    `import { resolve } from 'node:path'`,
    `import { scanServerRoutes, matchRoute, executeRoute, createProductionLoader, extractTraceIdFromRequest, TRACE_HEADER, createCorsWebHandler } from 'theokit/server'`,
    `import { createWebShim } from 'theokit/adapters/web-shim'`,
    `import { buildSecurityHeaders, withSecurityHeaders } from 'theokit/adapters/security-headers'`,
    ``,
    `// Cold-start cache`,
    `let routesCache = null`,
    `let loaderCache = null`,
    `const serverDir = resolve(process.cwd(), 'server')`,
    ``,
    `// #410 — the security baseline \`theokit start\` puts on every response,`,
    `// carried here as a literal because the deployed function has no`,
    `// theo.config.ts to read. config.json routes only /api/* here, so this`,
    `// covers the API and not the document Vercel's static host serves`,
    `// (usetheokit/theokit#412).`,
    `const SECURITY_HEADERS_CONFIG = ${renderSecurityHeadersConfigLiteral(opts.securityHeaders)}`,
    `const SECURITY_HEADERS = buildSecurityHeaders(SECURITY_HEADERS_CONFIG, { production: true })`,
    ``,
    ...runtimeConfig.imports,
    ...runtimeConfig.declarations,
    ...deployedCsrfFragment(opts),
    ``,
    ...deployedCorsFragment(opts.cors, 'vercel'),
    ``,
    `// Vercel Functions invoke this default export with a (req, res) pair`,
    `// (Node IncomingMessage-style). \`routeRequest\` produces a Web Response for`,
    `// every outcome — including the two 404s — so the security baseline is`,
    `// applied at ONE place and no branch can be added that skips it.`,
    ...vercelHandlerFragment(),
    ``,
    ...vercelRouteRequestFragment(runtimeConfig.executeRouteSpread),
  ].join('\n')
}

export interface VercelRoutingRule {
  src?: string
  dest?: string
  handle?: string
  /** Build Output API v3 — response headers this rule adds. */
  headers?: Record<string, string>
  /**
   * Keep routing after this rule matches.
   *
   * Load-bearing for the header rule: without it a matching rule TERMINATES routing in Build
   * Output v3, so every request would receive the headers and no content.
   */
  continue?: boolean
}

/**
 * The routing table, plus the security baseline for the responses this build does NOT serve.
 *
 * The emitted function applies the baseline to every response IT returns — and it never returns the
 * HTML document: `{ handle: 'filesystem' }` hands the page to Vercel's static host, so the JSON was
 * protected and the page it renders in was not (usetheokit/theokit#412).
 *
 * The values come from `buildSecurityHeaders`, the same function the handler calls, rather than
 * being written out here. Two lists of headers that must agree are two lists that eventually do
 * not.
 *
 * Order matters twice: the header rule sits FIRST, because a rule after `handle: 'filesystem'`
 * never runs for a static file, and it carries `continue: true`, because a matching rule otherwise
 * ends routing and the request would get headers with no body.
 *
 * What this does NOT prove: that a deployed page carries them. That needs a deployment, and this
 * repository deploys to no Vercel project from CI. The emitted configuration is verifiable; the
 * platform honouring it is not, and the difference is stated rather than glossed.
 */
export function renderVercelConfigJson(securityHeaders?: SecurityHeadersConfig): {
  version: number
  routes: VercelRoutingRule[]
} {
  return {
    version: 3,
    routes: [
      {
        src: '/(.*)',
        headers: buildSecurityHeaders(securityHeaders ?? {}, { production: true }),
        continue: true,
      },
      { src: '/api/(.*)', dest: '/api' },
      { handle: 'filesystem' },
      { src: '/(.*)', dest: '/index.html' },
    ],
  }
}

export function renderVercelVcConfigJson(): {
  runtime: string
  handler: string
  launcherType: string
  shouldAddHelpers: boolean
  supportsResponseStreaming: boolean
} {
  return {
    runtime: 'nodejs22.x',
    handler: 'index.mjs',
    launcherType: 'Nodejs',
    shouldAddHelpers: true,
    // #382 — Build Output API v3 opt-in. Without it the platform buffers the
    // function's response no matter how the handler writes it, so the emitted
    // chunk-by-chunk drain above would never reach the client. We cannot
    // verify the platform side from here; see the streaming note in
    // `adapters/web-shim.ts` and the adapter's `streamsResponses` flag.
    supportsResponseStreaming: true,
  }
}

export const vercelAdapter: DeployAdapter = {
  name: 'vercel',
  streamsResponses: true,
  // #409 / #410 — the generated entry calls `executeRoute` with routes, loader
  // and serverDir only. CSRF, route policy, file middleware and Zod validation
  // still run because they live inside `executeRoute`; none of the remaining
  // configurable concerns reach it. Declared explicitly rather than omitted so
  // the gap is a statement in the source and not an absence.
  //
  // `securityHeaders` IS applied -- to every response this function returns.
  // The document is served from `.vercel/output/static` and does not pass
  // through it (usetheokit/theokit#412).
  appliesConfig: ['securityHeaders', 'csrf', 'disallowed', 'cors', 'serialization'],

  async build(config: TheoConfig, cwd: string, ctx?: AdapterBuildContext): Promise<void> {
    // Wave 2 (T2.2) — reject polyglot services on this adapter.
    // Per 2026-05-27 owner decision, polyglot is wired via `node` (local
    // docker-compose harness) + `theo-cloud` (Wave 3). Vercel adapter
    // wire-up is deferred to a fresh ADR with demand evidence.
    assertServicesUnsupported('vercel', readManifest(cwd))

    // 1. Run the standard Node build first (ctx forwarded so nodeAdapter has makeVitePlugins)
    await nodeAdapter.build(config, cwd, ctx)

    const clientDir = resolve(cwd, '.theokit/client')
    const outputDir = resolve(cwd, '.vercel/output')

    // 2. Create .vercel/output structure
    mkdirSync(resolve(outputDir, 'static'), { recursive: true })
    mkdirSync(resolve(outputDir, 'functions/api.func'), { recursive: true })

    // 3. Copy static assets
    if (existsSync(clientDir)) {
      cpSync(clientDir, resolve(outputDir, 'static'), { recursive: true })
    }

    // 4. Emit serverless function entry (now uses shared web-shim)
    writeFileSync(
      resolve(outputDir, 'functions/api.func/index.mjs'),
      renderVercelFunctionEntry({
        securityHeaders: config.security?.headers,
        csrf: config.security?.csrf,
        disallowed: config.security?.disallowed,
        cors: config.security?.cors,
        // #425 — a selector, not a transformer, so it rides as a literal like the values above.
        serialization: config.serialization,
      }),
    )

    // 5. Emit .vc-config.json
    writeFileSync(
      resolve(outputDir, 'functions/api.func/.vc-config.json'),
      JSON.stringify(renderVercelVcConfigJson(), null, 2),
    )

    // 6. Emit config.json (routing)
    writeFileSync(
      resolve(outputDir, 'config.json'),
      JSON.stringify(renderVercelConfigJson(config.security?.headers), null, 2),
    )

    // eslint-disable-next-line no-console -- CLI build progress
    console.log('\n  ✓ Vercel output → .vercel/output/')
    // eslint-disable-next-line no-console -- CLI build progress
    console.log(
      `${describeDeployedSecurityHeaders({
        target: 'vercel',
        securityHeaders: config.security?.headers,
        mintsNonce: false,
        documentHeaders: 'platform-configured',
      })}\n`,
    )
  },
}
