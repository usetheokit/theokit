/* eslint-disable security/detect-non-literal-fs-filename --
 * Bun deploy adapter. Writes to `cwd/.theokit/bun/`. Build-time.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { TheoConfig } from '../config/schema.js'
import type { SecurityHeadersConfig } from '../core/contracts/security-headers.js'
import { assertServicesUnsupported, readManifest } from '../services/index.js'

import { deployedAgentsFragment } from './deployed-agents.js'
import { type DeployedCorsOptions } from './deployed-cors.js'
import { type DeployedCsrfOptions } from './deployed-csrf.js'
import { readDocumentShell } from './deployed-document-shell.js'
import { planDeployedPlugins } from './deployed-plugins-module.js'
import { deployedEntryPreamble } from './deployed-preamble.js'
import {
  deployedRateLimitFragment,
  rateLimitCheckFragment,
  type DeployedRateLimitOptions,
} from './deployed-rate-limit.js'
import {
  deployedRuntimeConfigFragment,
  agentsDirLiteral,
  serverDirLiteral,
  type DeployedRuntimeConfigOptions,
  type DeployedAgentsDirOptions,
  type DeployedServerDirOptions,
} from './deployed-runtime-config.js'
import { deployedTraceFragment } from './deployed-trace.js'
import { nodeAdapter } from './node.js'
import { describeDeployedSecurityHeaders } from './security-headers.js'
import type { AdapterBuildContext, DeployAdapter } from './types.js'

export interface BunBuildDeps {
  runNodeBuild?: (config: TheoConfig, cwd: string, ctx?: AdapterBuildContext) => Promise<void>
  writeEntry?: (path: string, content: string) => void
  ensureDir?: (path: string) => void
}

/**
 * The module-scope refusals: this entry is production-only and Bun-only.
 *
 * Extracted from `renderBunEntry` when adding the configured-directory literal pushed it past the
 * per-function line budget. They are a cohesive block — three checks that all refuse to start —
 * and lifting them keeps the budget a signal about the renderer rather than about its preamble.
 */
const RUNTIME_GUARDS: readonly string[] = [
  `// EC-1: dev-mode guard`,
  `if (process.env.NODE_ENV !== 'production') {`,
  `  console.error('TheoBunAdapter is production-only. Use \\'theokit dev\\' (Node) for development.')`,
  `  process.exit(1)`,
  `}`,
  ``,
  `// Version check: Bun >= 1.1`,
  `if (typeof Bun === 'undefined') {`,
  `  console.error('TheoBunAdapter must run inside Bun. Got Node.js or unknown runtime.')`,
  `  process.exit(1)`,
  `}`,
  `{`,
  `  const [maj, min] = (Bun.version ?? '0.0').split('.').map(Number)`,
  `  if (maj < 1 || (maj === 1 && min < 1)) {`,
  `    console.error('TheoBunAdapter requires Bun >= 1.1; got ' + Bun.version)`,
  `    process.exit(1)`,
  `  }`,
  `}`,
]

export function renderBunEntry(
  port: number,
  opts: {
    ssrStreaming?: boolean
    /**
     * Whether this build renders the document on the server.
     *
     * Bun is the one Web target whose own handler answers the HTML document, and it answered it from
     * `.theokit/client/index.html` — the client shell. So an `ssr: true` project was served an empty
     * `<div id="root">` while the build printed `(SSR)` (B-334).
     */
    ssr?: boolean
    /** The document up to `<div id="root">`, read from the built client shell. */
    htmlHead?: string
    /** The document from `<div id="root">` on. */
    htmlTail?: string
    securityHeaders?: SecurityHeadersConfig
  } & DeployedAgentsDirOptions &
    DeployedCsrfOptions &
    DeployedRuntimeConfigOptions &
    DeployedServerDirOptions &
    DeployedCorsOptions &
    DeployedRateLimitOptions = {},
): string {
  // The whole implementation of `ssrStreaming` in this adapter used to be the text of this comment:
  // `opts.ssrStreaming` was read, and its only effect was which string landed on line 4 of the emitted
  // file. `rules/foreign-config-surfaces.md` names that exact failure — "A surface is read, or it is
  // refused with a reason. It is never accepted and ignored" — and it was in this adapter.
  const document =
    opts.ssr === true ? { htmlHead: opts.htmlHead, htmlTail: opts.htmlTail } : undefined
  const streamingComment =
    document !== undefined
      ? `// ssr on — the document is rendered by this handler, not read from .theokit/client`
      : `// ssr off — the document is the built client shell, served from disk`
  const runtimeConfig = deployedRuntimeConfigFragment(opts)
  const agentsFragment = deployedAgentsFragment(
    {
      kind: 'scan',
      projectRoot: 'cwd',
      loadModule: 'loadModule',
      serverDir: 'serverDir',
      agentsDirLiteral: agentsDirLiteral(opts),
    },
    {
      pathname: 'pathname',
      // B-185 — bound only when the runtime-config fragment declared the const, which is
      // exactly when a plugins module was emitted. Referencing it otherwise would emit an
      // identifier the entry never declares.
      pluginRunnerExpr:
        opts.runtimeConfigModule === undefined ? undefined : 'await THEO_PLUGIN_RUNNER',
    },
  )
  return [
    `// Generated by Theo — Bun Adapter`,
    `// Run: bun run .theokit/bun/server.mjs`,
    `// Requires Bun >= 1.1`,
    streamingComment,
    ``,
    ...RUNTIME_GUARDS,
    ``,
    `import { resolve, join } from 'node:path'`,
    `import { existsSync } from 'node:fs'`,
    // One element per emitted line, like every neighbour, and the conditional import is a spread
    // rather than an interpolated `\n`. That is not a style preference: this line carried the
    // fragment inside a nested double-quoted string, where an escaped backslash is a backslash, so
    // the import reached the module joined by two characters and Bun refused it. A construct that
    // cannot express a malformed line beats one escaped correctly (B-325), and `sonarjs` refuses the
    // nesting outright — the lint was naming the cause.
    `import { scanServerRoutes, matchRoute, createProductionLoader } from 'theokit/server/scan'`,
    `import { executeRoute, extractTraceIdFromRequest, TRACE_HEADER, createCorsWebHandler } from 'theokit/server/http'`,
    ...(opts.rateLimit === undefined
      ? []
      : [`import { createRateLimiterWeb } from 'theokit/server/rate-limit'`]),
    `import { createWebShim } from 'theokit/adapters/web-shim'`,
    `import { buildSecurityHeaders, withSecurityHeaders } from 'theokit/adapters/security-headers'`,
    // The renderer the node build already emits for this target and nothing imported. Its own header
    // names Bun: "Web Standards streaming entry for edge runtimes (Cloudflare, Bun, Deno, Vercel
    // Edge)". Measured on a real build: `.theokit/server/entry-server.js` is 95513 bytes and exports
    // the render, and `.theokit/bun/server.mjs` referenced it zero times.
    ...(document === undefined
      ? []
      : [`import { renderStreamingWeb } from '../server/entry-server.js'`]),
    `// T3.2 — WS bridge for Bun runtime`,
    `import { createBunWsBridge } from 'theokit/adapters/ws-shim'`,
    `import { scanWebSocketRoutes } from 'theokit/server/scan'`,
    ``,
    `const cwd = process.cwd()`,
    `const clientDir = resolve(cwd, '.theokit/client')`,
    `const serverDir = resolve(cwd, ${serverDirLiteral(opts)})`,
    `const port = process.env.PORT ? Number(process.env.PORT) : ${port}`,
    ``,
    `// #410 — the security baseline \`theokit start\` puts on every response,`,
    `// carried here as a literal because the deployed process has no`,
    `// theo.config.ts to read. Bun is the one Web target whose own handler serves`,
    `// the HTML document (static file + SPA fallback below), so the document gets`,
    `// these headers too -- with a nonce-less CSP, because that HTML was written`,
    `// at build time and carries no nonce on its script tags (EC-4).`,
    ...deployedEntryPreamble(runtimeConfig, agentsFragment, opts, 'bun'),
    ``,
    ...deployedRateLimitFragment(opts.rateLimit, 'bun', 'server.requestIP(request)?.address'),
    ``,
    `const routes = existsSync(serverDir) ? scanServerRoutes(serverDir) : []`,
    `const wsRoutes = existsSync(serverDir) ? scanWebSocketRoutes(serverDir) : []`,
    `const loadModule = createProductionLoader()`,
    ``,
    `// Bun WebSocket config — single handler dispatches to first ws route,`,
    `// or a default no-op when none declared. Per-route routing happens above`,
    `// (the upgrade decision is made in fetch handler before Bun.serve hands off).`,
    `const wsBridge = wsRoutes.length > 0`,
    `  ? createBunWsBridge({`,
    `      onOpen: () => {},`,
    `      onMessage: (ws, data) => { ws.send(data) },`,
    `      onClose: () => {},`,
    `    })`,
    `  : { open: () => {}, message: () => {}, close: () => {} }`,
    ``,
    `function notFoundResponse() {`,
    `  return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found' } }), {`,
    `    status: 404,`,
    `    headers: { 'Content-Type': 'application/json' },`,
    `  })`,
    `}`,
    ``,
    `Bun.serve({`,
    `  port,`,
    `  websocket: wsBridge,`,
    `  async fetch(request, server) {`,
    `    // #409 — the preflight is answered BEFORE anything routes: an OPTIONS the router`,
    `    // handles is an OPTIONS the browser never gets a CORS answer to.`,
    `    const preflight = corsPreflight(request)`,
    `    if (preflight !== null) return withSecurityHeaders(preflight, SECURITY_HEADERS)`,
    ...rateLimitCheckFragment(opts.rateLimit, '    '),
    `    return withCors(request, withSecurityHeaders(await handleRequest(request), SECURITY_HEADERS))`,
    `  },`,
    `})`,
    ``,
    ...bunHandleRequestFragment(runtimeConfig.executeRouteSpread, agentsFragment.branch, document),
  ].join('\n')
}

/**
 * The request handler, as generated source.
 *
 * Extracted for the reason `vercel.ts` extracts its own fragments: the emitter is one array
 * literal, so every line the entry gains counts against `max-lines-per-function`, and #410 added
 * the CSRF literal to an emitter that was already sitting exactly at the ceiling.
 */
function bunHandleRequestFragment(
  runtimeSpread: string,
  agentBranch: readonly string[],
  document: { htmlHead?: string; htmlTail?: string } | undefined,
): string[] {
  return [
    `async function handleRequest(request) {`,
    `    const url = new URL(request.url)`,
    `    const pathname = url.pathname`,
    ``,
    `    // 1) Static assets`,
    ...(document === undefined
      ? [
          `    const staticPath = pathname === '/' ? '/index.html' : pathname`,
          `    const fullStatic = join(clientDir, staticPath)`,
          `    if (existsSync(fullStatic)) {`,
          `      const file = Bun.file(fullStatic)`,
          `      if (await file.exists()) return new Response(file)`,
          `    }`,
        ]
      : [
          `    // \`/\` is deliberately NOT mapped to index.html here: that file is the client shell,`,
          `    // and answering the document from it is what served an empty <div id="root"> on an`,
          `    // ssr build. Real assets still come from disk; the document falls through to (3).`,
          `    if (pathname !== '/') {`,
          `      const fullStatic = join(clientDir, pathname)`,
          `      if (existsSync(fullStatic)) {`,
          `        const file = Bun.file(fullStatic)`,
          `        if (await file.exists()) return new Response(file)`,
          `      }`,
          `    }`,
        ]),
    ``,
    `    // 2) API routes through the full executeRoute pipeline via the shim`,
    `    if (pathname.startsWith('/api/') || __theoIsAgentCardPath(pathname)) {`,
    ...agentBranch,
    ``,
    `      const match = matchRoute(pathname, routes)`,
    `      if (!match) return notFoundResponse()`,
    `      const { req, res, toResponse } = createWebShim(request)`,
    ...deployedTraceFragment('request', '      '),
    `      const method = request.method.toUpperCase()`,
    `      // #382 — not awaited: toResponse() settles at the headers and carries`,
    `      // a live body, so Bun.serve streams while the handler writes.`,
    `      return toResponse(executeRoute({ route: match.route, method, params: match.params, req, res, loadModule, serverDir, requestId, ...CSRF_CONFIG, ${runtimeSpread} }))`,
    `    }`,
    ``,
    ...(document === undefined
      ? [
          `    // 3) SPA fallback`,
          `    const indexPath = join(clientDir, 'index.html')`,
          `    if (existsSync(indexPath)) return new Response(Bun.file(indexPath))`,
        ]
      : [
          `    // 3) The document, rendered here rather than read from disk.`,
          `    //`,
          `    // No nonce is minted: the outer wrapper applies a precomputed SECURITY_HEADERS constant,`,
          `    // so a per-request value would have to be threaded through it. That is a separate change`,
          `    // with its own blast radius, and the shell this replaces carries only external`,
          `    // <script src> tags, which \`script-src 'self'\` already allows.`,
          `    return await renderStreamingWeb(request, {`,
          `      htmlHead: ${JSON.stringify(document.htmlHead ?? '')},`,
          `      htmlTail: ${JSON.stringify(document.htmlTail ?? '')},`,
          `    })`,
        ]),
    ``,
    `    return notFoundResponse()`,
    `}`,
    ``,
    `console.log('Theo (Bun) listening on http://localhost:' + port)`,
  ]
}

export async function buildBun(
  config: TheoConfig,
  cwd: string,
  deps: BunBuildDeps = {},
  ctx?: AdapterBuildContext,
): Promise<void> {
  // Wave 2 (T2.2) — reject polyglot services on this adapter.
  assertServicesUnsupported('bun', readManifest(cwd))

  const runNodeBuild = deps.runNodeBuild ?? nodeAdapter.build.bind(nodeAdapter)
  await runNodeBuild(config, cwd, ctx)

  const outputDir = resolve(cwd, '.theokit/bun')
  const ensureDir = deps.ensureDir ?? ((p: string) => mkdirSync(p, { recursive: true }))
  ensureDir(outputDir)

  const pluginsPlan = planDeployedPlugins(config.plugins, 'bun')
  const entry = renderBunEntry(config.port, {
    ssrStreaming: config.ssrStreaming,
    // B-334 — the sixth time this shape has been fixed one target at a time: the renderer honoured an
    // option no build passed (B-185, B-235, B-312, B-315, B-317). Here it was worse — the option only
    // changed a comment. The shell is read HERE rather than in the emitter, because reading a file is
    // the build's job and not a string emitter's.
    ssr: config.ssr,
    ...readDocumentShell(cwd, config.ssr),
    securityHeaders: config.security?.headers,
    csrf: config.security?.csrf,
    disallowed: config.security?.disallowed,
    cors: config.security?.cors,
    // #425 — a selector, not a transformer, so it rides as a literal like the values above.
    serialization: config.serialization,
    // #425 — the ONE concern that is not a literal. A closure cannot be baked, so a plugin
    // declared by module specifier is imported by the emitted module instead; a constructed one
    // is refused by name at build time rather than dropped in silence.
    runtimeConfigModule: pluginsPlan?.moduleSpecifier,
    // #95 — the configured directories, which `build.ts:210` already threads into the Vite
    // plugins. Without these two lines the literals above fall to their defaults and a project
    // with a custom dir deploys an entry that resolves a directory it does not have.
    serverDir: config.serverDir,
    agentsDir: config.agentsDir,
  })
  const write =
    deps.writeEntry ??
    ((p, c) => {
      writeFileSync(p, c)
    })
  if (pluginsPlan !== undefined) {
    // Beside the entry, so the emitted import is a sibling. Written through the same seam as
    // the entry so a test that captures one captures both (#425).
    write(resolve(outputDir, 'theo.plugins.mjs'), pluginsPlan.source)
  }
  write(resolve(outputDir, 'server.mjs'), entry)

  // eslint-disable-next-line no-console -- CLI build progress
  console.log('\n  ✓ Bun output → .theokit/bun/server.mjs')
  // eslint-disable-next-line no-console -- CLI build progress
  console.log(
    `${describeDeployedSecurityHeaders({
      target: 'bun',
      securityHeaders: config.security?.headers,
      // Bun renders the document at request time when `ssr` is on (B-334), and still mints no nonce:
      // the outer wrapper applies a precomputed SECURITY_HEADERS constant, so a per-request value
      // would have to be threaded through it.
      //
      // This used to read "No deploy target other than the streamed Cloudflare worker renders HTML at
      // request time, so none of the rest can mint a nonce." True when written, false the moment B-317
      // shipped — a CONSEQUENCE of the fleet at the time, never a prohibition, which is why rendering
      // here is consistent with the intent rather than against it.
      mintsNonce: false,
      // Bun serves `.theokit/client` itself, so the document DOES pass through
      // the handler these headers are attached to.
      documentHeaders: 'handler',
    })}\n`,
  )
}

export const bunAdapter: DeployAdapter = {
  name: 'bun',
  streamsResponses: true,
  // #409 / #410 — the generated entry calls `executeRoute` with routes, loader
  // and serverDir only. CSRF, route policy, file middleware and Zod validation
  // still run because they live inside `executeRoute`; none of the remaining
  // configurable concerns reach it. Declared explicitly rather than omitted so
  // the gap is a statement in the source and not an absence.
  //
  // `securityHeaders` IS applied: the entry carries `security.headers` as a
  // literal and puts the built baseline on every response, the served document
  // included.
  servesAgents: true,
  appliesConfig: [
    'securityHeaders',
    'csrf',
    'disallowed',
    'cors',
    'serialization',
    'plugins',
    // #508 — bun is the first Web target to ENFORCE a declared limit rather than refuse the
    // build: `Bun.serve` is long-lived, so the in-process counter survives, and its handler
    // already receives `server`, whose `requestIP` gives the peer address without a header.
    'rateLimit',
  ],
  // B-257 — a long-lived process: the in-process counter survives between requests.
  enforcesRateLimit: 'always',
  build(config, cwd, ctx) {
    return buildBun(config, cwd, {}, ctx)
  },
}
