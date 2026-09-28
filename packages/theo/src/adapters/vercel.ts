/* eslint-disable security/detect-non-literal-fs-filename --
 * Vercel deploy adapter. All paths derived from `cwd` and a fixed
 * `.theokit/vercel/` output layout. Build-time tool — no HTTP input.
 */
import { existsSync, mkdirSync, writeFileSync, cpSync } from 'node:fs'
import { resolve } from 'node:path'

import type { TheoConfig } from '../config/schema.js'
import type { SecurityHeadersConfig } from '../core/contracts/security-headers.js'
import { assertServicesUnsupported, readManifest } from '../services/index.js'

import { bundleDeployedFunction } from './bundle-deployed-function.js'
import { deployedAgentsFragment, JSON_NOT_FOUND_RESPONSE } from './deployed-agents.js'
import { renderBakedRoutes, routeRuntimeLines, type BakedRoute } from './deployed-baked-routes.js'
import { deployedEntryPreamble } from './deployed-preamble.js'
import {
  deployedRateLimitFragment,
  rateLimitCheckFragment,
  type DeployedRateLimitOptions,
} from './deployed-rate-limit.js'
import { deployedRuntimeConfigFragment, serverDirLiteral } from './deployed-runtime-config.js'
import { deployedTraceFragment } from './deployed-trace.js'
import { nodeAdapter } from './node.js'
import { buildSecurityHeaders, describeDeployedSecurityHeaders } from './security-headers.js'
import type { AdapterBuildContext, DeployAdapter, DeployedEntryOptions } from './types.js'

/**
 * T2.2 — Vercel adapter rewritten to consume `theokit/adapters/web-shim`
 * instead of emitting an inline plain-object Request/Response shim and
 * lazy-importing internal `theo-server/` paths.
 */

// Generated-code fragments — extracted so the parent emitter stays under the
// max-lines-per-function ceiling.
/** The exported function Vercel invokes: one security-header call, then the drain. */
function vercelHandlerFragment(
  /** B-027 — passed, not read: this is a separate function from the parent emitter. */
  rateLimit: DeployedRateLimitOptions['rateLimit'],
): string[] {
  return [
    // B-027 — only when a limit is declared. `createRateLimiterWeb` is used at module scope by
    // the fragment; `resolveClientIpFromRequest` reads the forwarded headers behind `trustProxy`.
    ...(rateLimit === undefined
      ? []
      : [
          `import { createRateLimiterWeb } from 'theokit/server/rate-limit'`,
          `import { resolveClientIpFromRequest } from 'theokit/server/rate-limit'`,
        ]),
    ...deployedRateLimitFragment(
      rateLimit,
      'vercel',
      // The handler builds a real Web `Request` at the top — `corsRequest` — so the exported Web
      // resolver applies directly and nothing new has to parse a header. The plan expected a Node
      // sibling here on the ground that this handler "has no Web Request"; reading the emitted code
      // refuted that. With no `trustProxy` declared the resolver returns `undefined`, which is the
      // named 503: on this platform the socket address is always the platform's proxy, so a
      // fallback to it would be one shared bucket wearing a client's clothes.
      `resolveClientIpFromRequest(corsRequest, TRUST_PROXY)`,
      'corsRequest',
    ),
    ...(rateLimit === undefined
      ? []
      : [
          ``,
          `/**`,
          ` * Write a small, known response and finish.`,
          ` *`,
          ` * Not the drain below: that one exists to stream an arbitrary route response chunk by`,
          ` * chunk, honouring backpressure. A 429 or a 503 is a short JSON literal, so reusing the`,
          ` * streaming path would buy nothing and duplicating it would be worse.`,
          ` */`,
          `async function sendSmall(res, response) {`,
          `  const h = {}`,
          `  response.headers.forEach((v, k) => { h[k] = v })`,
          `  res.writeHead(response.status, h)`,
          `  res.end(await response.text())`,
          `}`,
        ]),
    ``,
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
    ...rateLimitCheckFragment(
      rateLimit,
      '  ',
      'corsRequest',
      // This handler returns NOTHING — it drains into `nodeRes`. A bare `return <Response>` would
      // answer the caller with nothing at all.
      'return sendSmall(nodeRes, withCors(corsRequest, withSecurityHeaders(rateLimited(limit), SECURITY_HEADERS)))',
      'return sendSmall(nodeRes, withCors(corsRequest, withSecurityHeaders(unnamedCaller(), SECURITY_HEADERS)))',
    ),
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
function vercelRouteRequestFragment(
  runtimeSpread: string,
  agentsBranch: readonly string[],
  agentsHostBypass: string,
): string[] {
  return [
    `async function routeRequest(nodeReq) {`,
    `  const url = new URL(nodeReq.url ?? '/', 'http://' + (nodeReq.headers?.host ?? 'localhost'))`,
    ``,
    `  if (!url.pathname.startsWith('/api/')${agentsHostBypass}) {`,
    `    return new Response('Not Found', {`,
    `      status: 404,`,
    `      headers: { 'content-type': 'text/plain; charset=utf-8' },`,
    `    })`,
    `  }`,
    ``,
    ``,
    // B-235 — the Node-to-Web conversion is hoisted ABOVE the agents branch, which names
    // `request` like every other host's, and an agent path never reaches a route match. The
    // rename from `webRequest` is what lets this target share the one fragment instead of a
    // fourth near-copy of it.
    //
    // The body is therefore drained before `matchRoute` rather than after, so an unmatched POST
    // now has its body read. That is a real change and the safer direction: an unconsumed Node
    // request socket is what keeps a connection open, and the drain already happened for every
    // request that matched.
    `  // Convert Node-style req to a Web Request — for the agents branch and for the shim`,
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
    `  const request = new Request(url.toString(), { method, headers, body })`,
    ``,
    ...agentsBranch,
    ``,
    `  const match = matchRoute(url.pathname, routes)`,
    `  if (!match) return ${JSON_NOT_FOUND_RESPONSE}`,
    ``,
    `  const { req, res, toResponse } = createWebShim(request)`,
    ...deployedTraceFragment('request', '  '),
    `  // #382 — executeRoute() is NOT awaited before the Response is taken:`,
    `  // toResponse() settles at the headers and carries a live body.`,
    `  return toResponse(executeRoute({`,
    `    route: match.route, method, params: match.params,`,
    `    req, res, loadModule, serverDir, requestId, ...CSRF_CONFIG, ${runtimeSpread}`,
    `  }))`,
    `}`,
  ]
}

export function renderVercelFunctionEntry(
  opts: DeployedEntryOptions & {
    /**
     * The routes, scanned on the BUILD machine (B-319).
     *
     * Build Output API v3 uploads a `.func` directory as it is, so the emitted entry's runtime
     * `scanServerRoutes` was a `readdirSync` against a directory that is not there — measured on a
     * deployed function: every `/api/*` answered its own JSON 404. Baked here for the reason
     * Cloudflare bakes (#369), through the same emitter, so the two cannot drift.
     */
    routes?: readonly BakedRoute[]
    /** The agents, for the same reason and from the same scan. */
    agents?: readonly { filePath: string; agentPath: string; name: string }[]
    /** The app's identity module, when it has one. */
    contextModule?: string
  } = {},
): string {
  const runtimeConfig = deployedRuntimeConfigFragment(opts)
  const { routeImports, routeModuleEntries, routeTableEntries } = renderBakedRoutes(
    opts.routes ?? [],
  )
  // B-235. This is the target the item's evidence was right about in form and wrong about in
  // consequence: the handler IS Node-shaped, and it already converts to a Web `Request` before
  // handing anything to the shim. Threading `nodeReq` through twelve sites says how the entry
  // RECEIVES a request, not whether it can produce the one this branch needs.
  // B-319 — ALWAYS baked, with no scan fallback. This platform uploads only what the build
  // bundled, so `scanAgents` cannot work here at any value: there is no source tree to read. A
  // fallback would preserve a behaviour that is broken by construction — an entry that scans, finds
  // nothing, and answers 404 while looking like it tried. With nothing baked the agents fragment is
  // empty, `/api/agents/<name>` falls through to the route matcher, and the 404 is honest.
  const agentsFragment = deployedAgentsFragment(
    { kind: 'baked', agents: opts.agents ?? [], contextModule: opts.contextModule },
    { notFound: JSON_NOT_FOUND_RESPONSE },
  )
  return [
    `// Generated by Theo — Vercel Functions adapter`,
    `// Environment variables are resolved at RUNTIME, not build time.`,
    ``,
    `import { resolve } from 'node:path'`,
    `import { matchRoute, compilePattern } from 'theokit/server/scan'\nimport { executeRoute, extractTraceIdFromRequest, TRACE_HEADER, createCorsWebHandler } from 'theokit/server/http'`,
    ...routeImports,
    `import { createWebShim } from 'theokit/adapters/web-shim'`,
    `import { buildSecurityHeaders, withSecurityHeaders } from 'theokit/adapters/security-headers'`,
    ``,
    ...routeRuntimeLines(routeModuleEntries, routeTableEntries, 'vercel'),
    // B-318 / B-319 — `const cwd` used to be declared here, because the agents fragment emitted
    // `scanAgents(cwd, …)` and this was the one of its four callers that never declared the name.
    // B-319 then removed the scan entirely from this target — there is no source tree to read on a
    // platform that uploads only its bundle — so the declaration became dead code. The pairing is
    // still enforced for the three adapters that DO scan, by
    // `tests/unit/a-generated-entry-declares-every-name-it-uses.test.ts`.
    `const serverDir = resolve(process.cwd(), ${serverDirLiteral(opts)})`,
    ``,
    `// #410 — the security baseline \`theokit start\` puts on every response,`,
    `// carried here as a literal because the deployed function has no`,
    `// theo.config.ts to read. config.json routes only /api/* here, so this`,
    `// covers the API and not the document Vercel's static host serves`,
    `// (usetheokit/theokit#412).`,
    ...deployedEntryPreamble(runtimeConfig, agentsFragment, opts, 'vercel'),
    ``,
    `// Vercel Functions invoke this default export with a (req, res) pair`,
    `// (Node IncomingMessage-style). \`routeRequest\` produces a Web Response for`,
    `// every outcome — including the two 404s — so the security baseline is`,
    `// applied at ONE place and no branch can be added that skips it.`,
    ...vercelHandlerFragment(opts.rateLimit),
    ``,
    ...vercelRouteRequestFragment(
      runtimeConfig.executeRouteSpread,
      agentsFragment.branch,
      agentsFragment.hostBypass,
    ),
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
  // B-257 — per-invocation: an in-process counter does not survive, so a declared limit needs a durable store.
  enforcesRateLimit: 'with-a-store',

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

    // B-319 — the routes, agents and identity module are resolved HERE, on the build machine, for
    // the reason #369 gives for Cloudflare: Build Output API v3 uploads the `.func` directory as it
    // is, so a runtime `scanServerRoutes` reads a directory that is not there. Measured on a
    // deployed function — every `/api/*` answered its own JSON 404 with the route files present in
    // the project. An absent provider bakes nothing and the entry falls back to the scan, which is
    // what it did before.
    const scanned = ctx?.scanRoutes?.(config.serverDir)

    // 4. Emit the serverless function, BUNDLED.
    //
    // B-316 / ADR 0020 — Build Output API v3 uploads a `.func` directory as it is: nothing installs
    // dependencies for it and nothing bundles it. Writing the rendered entry straight out produced a
    // function that could not start, measured on this repository's own scaffold:
    //
    //     cp -a .vercel/output/functions/api.func/. /tmp/fn/ && cd /tmp/fn
    //     node -e "import('./index.mjs')"
    //     -> ERR_MODULE_NOT_FOUND: Cannot find package 'theokit'
    //
    // The staged entry goes inside the project root because a specifier resolves relative to the
    // importing file — an entry in `/tmp` makes rollup resolve `theokit/server/scan` from `/tmp`.
    await bundleDeployedFunction({
      projectRoot: cwd,
      entrySource: renderVercelFunctionEntry({
        routes: scanned?.routes,
        agents: scanned?.agents,
        contextModule: scanned?.contextModule,
        securityHeaders: config.security?.headers,
        // B-315 — the option existed, the renderer honoured it, and this build never passed
        // it, so a project declaring `src/server` got a deployed entry resolving `server`.
        // The fourth occurrence of that exact shape: B-185 (bun, deno), B-235 (`agentsDir`
        // here), B-312 (the build's agents scan). Measured on the emitted Vercel function.
        serverDir: config.serverDir,
        // B-235 — pillar (a): the option existed and no build passed it, so a project with a
        // configured agents directory got the default `agents` on this target. Same defect
        // B-185 fixed for bun and deno, one target over.
        agentsDir: config.agentsDir,
        csrf: config.security?.csrf,
        disallowed: config.security?.disallowed,
        cors: config.security?.cors,
        // #425 — a selector, not a transformer, so it rides as a literal like the values above.
        serialization: config.serialization,
      }),
      stagePath: '.theokit/vercel/entry.mjs',
      outDir: resolve(outputDir, 'functions/api.func'),
      entryFileName: 'index.mjs',
    })

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
