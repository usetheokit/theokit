/* eslint-disable security/detect-non-literal-fs-filename --
 * Cloudflare deploy adapter. All write paths are under `cwd/.theokit/cloudflare/`
 * and `cwd/wrangler.toml`. Build-time tool — no HTTP input.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { TheoConfig } from '../config/schema.js'
import { findRootDiv } from '../core/contracts/find-root-div.js'
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
  describeDeployedSecurityHeaders,
  renderSecurityHeadersConfigLiteral,
} from './security-headers.js'
import type { AdapterBuildContext, DeployAdapter } from './types.js'

/**
 * T2.1 — Cloudflare adapter rewritten to consume `theokit/adapters/web-shim`
 * instead of emitting an inline plain-object Request/Response shim. Reduces
 * template from ~50 lines to ~25 and centralizes maintenance.
 */

/**
 * The built `index.html` split into the part before `<div id="root">` and the
 * part after it.
 *
 * Refuses by name when streaming is on and the template is missing, rather than
 * emitting a worker that serves a headless document. A build that cannot produce
 * a correct artifact should say so at build time; the alternative is a deploy
 * that looks successful and serves pages with no stylesheet.
 */
function readDocumentShell(
  cwd: string,
  streaming: boolean,
): { htmlHead?: string; htmlTail?: string } {
  if (!streaming) return {}

  const indexPath = resolve(cwd, '.theokit/client/index.html')
  if (!existsSync(indexPath)) {
    throw new Error(
      `[adapter-cloudflare] ssrStreaming is on but ${indexPath} does not exist, so the worker ` +
        `would serve a document with no <head> and no client entry. Run the client build first, ` +
        `or set ssrStreaming: false in theo.config.ts.`,
    )
  }

  const indexHtml = readFileSync(indexPath, 'utf-8')
  const rootDiv = findRootDiv(indexHtml)
  if (rootDiv === undefined) {
    throw new Error(
      `[adapter-cloudflare] ${indexPath} has no <div id="root">, so the streamed document has ` +
        `nowhere to put the app. Add one, or set ssrStreaming: false in theo.config.ts.`,
    )
  }

  return {
    htmlHead: indexHtml.slice(0, rootDiv.insertAt),
    htmlTail: indexHtml.slice(rootDiv.insertAt),
  }
}

/**
 * The routes, turned into source: static imports, a module map and a literal table (#369).
 *
 * Extracted so the worker renderer stays inside its length budget, and because this is the whole of
 * what changed about how a Worker finds a route — it reads as one idea rather than as three loops
 * inside a hundred lines of template.
 *
 * `../../` because the worker is written to `.theokit/cloudflare/worker.mjs` and `filePath` is
 * relative to the project root. The imports are static so Wrangler's bundler follows them:
 * `wrangler.toml` uploads `.theokit/client` and has never uploaded `server/`, so a module not
 * bundled INTO the worker is not on the platform at all.
 */
function renderBakedRoutes(
  routes: readonly { filePath: string; routePath: string; methods?: readonly string[] }[],
): { routeImports: string[]; routeModuleEntries: string[]; routeTableEntries: string[] } {
  const routeVar = (index: number): string => `__theoRoute${String(index)}`
  return {
    routeImports: routes.map(
      (route, index) => `import * as ${routeVar(index)} from '../../${route.filePath}'`,
    ),
    routeModuleEntries: routes.map(
      (route, index) => `  ${JSON.stringify(route.filePath)}: ${routeVar(index)},`,
    ),
    routeTableEntries: routes.map(
      (route) =>
        `  { filePath: ${JSON.stringify(route.filePath)}, routePath: ${JSON.stringify(route.routePath)}, ` +
        `methods: ${JSON.stringify([...(route.methods ?? [])])}, ` +
        `...compilePattern(${JSON.stringify(route.routePath)}) },`,
    ),
  }
}

/**
 * The route-resolution runtime the Worker gets instead of a directory scan (#369).
 *
 * A module map, the literal table, and a loader that refuses anything the build did not bake.
 * Emitted as its own block because it replaces one idea — "find the routes" — wholesale.
 */
function routeRuntimeLines(moduleEntries: string[], tableEntries: string[]): string[] {
  return [
    `// #369 — the routes are baked at build time. The Worker used to reach for`,
    `// \`scanServerRoutes\` on the server directory — a readdirSync, in a runtime with no`,
    `// filesystem. The pattern is recompiled here from the same routePath the scanner`,
    `// used, so one function decides precedence on every target.`,
    `const ROUTE_MODULES = {`,
    ...moduleEntries,
    `}`,
    ``,
    `const routes = [`,
    ...tableEntries,
    `]`,
    ``,
    `// The executor asks for a module by the path the table names. Anything else was`,
    `// never bundled, and saying so beats returning undefined and failing later on a`,
    `// property access far from the cause.`,
    `async function loadModule(path) {`,
    `  const mod = ROUTE_MODULES[path]`,
    `  if (mod === undefined) {`,
    // No backticks in this message: it is emitted INTO a template literal, and a stray one closes
    // it. That is how #344 shipped a SyntaxError, and the emitted-entry parse gate caught this one
    // before it left the branch.
    "  throw new Error(`Route module '" +
      '${path}' +
      "' was not bundled into this Worker. " +
      'A Worker has no filesystem, so every route is imported at build time. ' +
      'Re-run: theokit build --target cloudflare`)',
    `  }`,
    `  return mod`,
    `}`,
    ``,
  ]
}

export function renderCloudflareWorkerEntry(
  opts: {
    ssrStreaming?: boolean
    htmlHead?: string
    htmlTail?: string
    securityHeaders?: SecurityHeadersConfig
    /**
     * The server routes, scanned on the BUILD machine (#369).
     *
     * A Worker has no filesystem, so the worker used to call `scanServerRoutes` — a `readdirSync` —
     * against a directory that does not exist there, and load each module through `import()` of a
     * file path. Both are baked here instead, which is the road this adapter already takes for the
     * document shell one function away.
     *
     * `filePath` is relative to the project root and is used for two things: the key the executor
     * looks a module up by, and the specifier the static import uses. Paths are emitted relative to
     * `.theokit/cloudflare/`, where the worker is written.
     */
    routes?: readonly { filePath: string; routePath: string; methods?: readonly string[] }[]
    /**
     * The two concerns #410 could not bake (#425), composed from one place so the six targets
     * cannot drift into six spellings. `serialization` is a literal like the security values above;
     * `plugins` is an import, because a closure has no literal.
     */
    runtimeConfigModule?: DeployedRuntimeConfigOptions['runtimeConfigModule']
    serialization?: DeployedRuntimeConfigOptions['serialization']
    /** WebSocket route files, scanned on the build machine. Only their presence is used (#369). */
    wsRoutes?: readonly string[]
  } & DeployedCsrfOptions &
    DeployedCorsOptions = {},
): string {
  const streamingImport = opts.ssrStreaming
    ? `import { renderStreamingWeb } from '/@theo/entry-server'`
    : `// (ssrStreaming off: renderStreamingWeb not imported)`
  // #343 — the document shell is inlined as a build-time literal because a Worker
  // has no filesystem to read `index.html` from at request time. Without it,
  // `renderStreamingWeb` falls back to its empty-string defaults and the response
  // is React output with no `<html>`, no `<head>`, no stylesheet and no client
  // entry — hydration data for a page that cannot hydrate. The streaming
  // assembly was fixed in the generated entry and this, its only caller, was
  // left passing nothing.
  //
  // `JSON.stringify` and not a template literal: the shell contains quotes,
  // angle brackets and a `</script>`, and embedding it naively produces a worker
  // that fails to parse at deploy time rather than here.
  //
  // #410 — this is also the ONE deploy path that renders HTML at request time,
  // so the one that can mint a per-request CSP nonce: `renderStreamingWeb`
  // threads `options.nonce` into `renderToReadableStream` and into the hydration
  // script (`router/entry-server.ts`). Every other response below carries the
  // nonce-less baseline, which is what `buildSecurityHeaders` already does for a
  // prerendered route (EC-4).
  const nonApiBranch = opts.ssrStreaming
    ? [
        `      // T2.3 — streaming SSR for non-API routes`,
        `      // The same primitive \`theokit start\` uses, not a second one:`,
        `      // 16 bytes of Web Crypto entropy, base64.`,
        `      const nonce = generateNonce()`,
        `      return withSecurityHeaders(`,
        `        await renderStreamingWeb(request, {`,
        `          htmlHead: ${JSON.stringify(opts.htmlHead ?? '')},`,
        `          htmlTail: ${JSON.stringify(opts.htmlTail ?? '')},`,
        `          nonce,`,
        `        }),`,
        `        buildSecurityHeaders(SECURITY_HEADERS_CONFIG, { production: true }, { nonce }),`,
        `      )`,
      ].join('\n')
    : `      return notFoundResponse()`
  // CR-006: Workers lack `process.cwd()` and the `node:*` import surface
  // is brittle even under `nodejs_compat`. We use the Web Crypto
  // `crypto.randomUUID()` instead of `node:crypto.randomUUID`, and embed
  // the server directory as a build-time literal instead of resolving via
  // `node:path` at runtime.
  const { routeImports, routeModuleEntries, routeTableEntries } = renderBakedRoutes(
    opts.routes ?? [],
  )
  const runtimeConfig = deployedRuntimeConfigFragment(opts)

  return [
    `// Generated by Theo — Cloudflare Workers Adapter`,
    `//`,
    `// REQUIREMENTS (EC-3):`,
    `//   - wrangler.toml MUST include compatibility_flags = ["nodejs_compat"]`,
    `//     (still required for transitive theokit/server deps, e.g. busboy)`,
    `//   - package.json MUST list "theokit" in dependencies (not devDependencies)`,
    `//     so Wrangler bundles theokit and its transitive deps`,
    `//   - Deploy: wrangler deploy`,
    ``,
    `import { matchRoute, executeRoute, compilePattern, extractTraceIdFromRequest, TRACE_HEADER, createCorsWebHandler } from 'theokit/server'`,
    `import { createWebShim } from 'theokit/adapters/web-shim'`,
    opts.ssrStreaming
      ? `import { buildSecurityHeaders, generateNonce, withSecurityHeaders } from 'theokit/adapters/security-headers'`
      : `import { buildSecurityHeaders, withSecurityHeaders } from 'theokit/adapters/security-headers'`,
    `// T3.4 — WS bridge for Cloudflare Workers`,
    `import { createCloudflareWsBridge } from 'theokit/adapters/ws-shim'`,
    streamingImport,
    ``,
    ...runtimeConfig.imports,
    ...routeImports,
    ``,
    `// CR-006: server directory is a build-time literal — Workers cannot`,
    `// call process.cwd() and resolving paths at runtime returned '/server'.`,
    `const serverDir = 'server'`,
    ``,
    ...routeRuntimeLines(routeModuleEntries, routeTableEntries),
    `// #410 — the security baseline \`theokit start\` puts on every response, carried`,
    `// here as a literal because a Worker has no theo.config.ts to read. Same`,
    `// function, same input, so the deployed page and the local one cannot`,
    `// disagree about what the configuration means.`,
    `const SECURITY_HEADERS_CONFIG = ${renderSecurityHeadersConfigLiteral(opts.securityHeaders)}`,
    `const SECURITY_HEADERS = buildSecurityHeaders(SECURITY_HEADERS_CONFIG, { production: true })`,
    ``,
    ...deployedCsrfFragment(opts, 'a Worker'),
    ``,
    ...runtimeConfig.declarations,
    ...deployedCorsFragment(opts.cors, 'cloudflare'),
    `// #369 — whether this project declares a WebSocket route, decided at build time. It used`,
    `// to answer it with \`scanWebSocketRoutes\`, which is the same readdirSync.`,
    `const HAS_WS_ROUTES = ${String((opts.wsRoutes ?? []).length > 0)}`,
    ``,
    `function notFoundResponse() {`,
    `  return withSecurityHeaders(`,
    `    new Response(`,
    `      JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Route not found' } }),`,
    `      { status: 404, headers: { 'Content-Type': 'application/json' } },`,
    `    ),`,
    `    SECURITY_HEADERS,`,
    `  )`,
    `}`,
    ``,
    ...cloudflareHandleRequestFragment(nonApiBranch, runtimeConfig.executeRouteSpread),
  ].join('\n')
}

/**
 * The Worker's request handler, as generated source.
 *
 * Extracted for the reason `vercel.ts` extracts its own fragments: the emitter is one array
 * literal, so every line the entry gains counts against `max-lines-per-function`, and #410 added
 * the CSRF literal to an emitter already sitting exactly at the ceiling.
 *
 * @param nonApiBranch - what a non-`/api/` request gets, which differs with `ssrStreaming`
 */
function cloudflareHandleRequestFragment(nonApiBranch: string, runtimeSpread: string): string[] {
  return [
    `async function handleRequest(request, url) {`,
    `    if (!url.pathname.startsWith('/api/')) {`,
    nonApiBranch,
    `    }`,
    ``,
    `    const match = matchRoute(url.pathname, routes)`,
    `    if (!match) return notFoundResponse()`,
    ``,
    `    const { req, res, toResponse } = createWebShim(request, { trustedProxy: 'platform' })`,
    ...deployedTraceFragment('request', '    '),
    `    const method = request.method.toUpperCase()`,
    `    // #382 — the run is NOT awaited before the Response is taken. toResponse()`,
    `    // settles as soon as status + headers are known and carries a live body, so`,
    `    // the Worker starts flushing while the handler is still writing. Awaiting`,
    `    // executeRoute() first would re-buffer the whole response here even though`,
    `    // the shim streams; awaiting toResponse() does not — it settles at the head.`,
    `    return withSecurityHeaders(await toResponse(executeRoute({`,
    `      route: match.route, method, params: match.params,`,
    `      req, res, loadModule, serverDir, requestId, ...CSRF_CONFIG, ${runtimeSpread}`,
    `    })), SECURITY_HEADERS)`,
    `}`,
    ``,
    `export default {`,
    `  async fetch(request, env, ctx) {`,
    `    const url = new URL(request.url)`,
    ``,
    `    // T3.4 — Detect WebSocket upgrade and delegate to the CF bridge.`,
    `    // A 101 carries no document and no script, so the security baseline does`,
    `    // not apply to it.`,
    `    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {`,
    `      if (!HAS_WS_ROUTES) return notFoundResponse()`,
    `      const cfWs = createCloudflareWsBridge({`,
    `        onOpen: () => {},`,
    `        onMessage: (ws, data) => { ws.send(data) },`,
    `        onClose: () => {},`,
    `      })`,
    `      return cfWs.handle(request)`,
    `    }`,
    ``,
    `    // #409 — the preflight is answered BEFORE anything routes: an OPTIONS the router handles`,
    `    // is an OPTIONS the browser never gets a CORS answer to. The WebSocket upgrade above is`,
    `    // deliberately upstream of it — a 101 is not a CORS-governed response.`,
    `    const preflight = corsPreflight(request)`,
    `    if (preflight !== null) return withSecurityHeaders(preflight, SECURITY_HEADERS)`,
    ``,
    `    return withCors(request, await handleRequest(request, url))`,
    `  },`,
    `}`,
  ]
}

export function renderWranglerToml(): string {
  return [
    `# Generated by Theo — Cloudflare Workers`,
    `name = "theo-app"`,
    `main = ".theokit/cloudflare/worker.mjs"`,
    `compatibility_date = "2025-09-01"`,
    `compatibility_flags = ["nodejs_compat"]`,
    ``,
    `[site]`,
    `bucket = ".theokit/client"`,
    ``,
    `# Environment variables are set via wrangler secret or dashboard`,
    `# Example: wrangler secret put DATABASE_URL`,
  ].join('\n')
}

export const cloudflareAdapter: DeployAdapter = {
  name: 'cloudflare',
  streamsResponses: true,
  // #409 / #410 — the generated entry calls `executeRoute` with routes, loader
  // and serverDir only. CSRF, route policy, file middleware and Zod validation
  // still run because they live inside `executeRoute`; none of the remaining
  // configurable concerns reach it. Declared explicitly rather than omitted so
  // the gap is a statement in the source and not an absence.
  //
  // `securityHeaders` IS applied: the worker carries `security.headers` as a
  // literal and puts the built baseline on every response it returns, including
  // the streamed SSR document — with a per-request nonce, the only deploy path
  // that can mint one (`adapters/security-headers.ts`).
  appliesConfig: ['securityHeaders', 'csrf', 'disallowed', 'cors', 'serialization'],

  async build(config: TheoConfig, cwd: string, ctx?: AdapterBuildContext): Promise<void> {
    // Wave 2 (T2.2) — reject polyglot services on this adapter.
    assertServicesUnsupported('cloudflare', readManifest(cwd))

    // 1. Run the standard Node build first (ctx forwarded so nodeAdapter has makeVitePlugins)
    await nodeAdapter.build(config, cwd, ctx)

    const outputDir = resolve(cwd, '.theokit/cloudflare')
    mkdirSync(outputDir, { recursive: true })

    // 2. Emit Worker entry (now uses the shared web-shim)
    //
    // The document shell is read HERE, after the Node build produced
    // `.theokit/client/index.html`, and inlined into the worker: a Worker has no
    // filesystem at request time. Split on the root div with the same helper the
    // Node server uses (`ssr-setup.ts`), so the two paths cannot disagree about
    // where the shell ends (#343).
    const shell = readDocumentShell(cwd, config.ssrStreaming)

    // #369 — the routes are resolved HERE, on the build machine, for the same reason the document
    // shell above is read here: a Worker has no filesystem at request time, and the worker used to
    // run the scan itself against a directory that does not exist there.
    //
    // The scanner is INJECTED rather than imported: importing it would add an `adapters → server`
    // edge, which is the layering inversion ADR-0001 v3 removed for `vite-plugin` and which
    // `adapters-may-only-depend-on-core-router-services` refuses. An absent scanner emits a worker
    // with no routes rather than falling back to a runtime scan — the fallback IS the defect.
    const scanned = ctx?.scanRoutes?.(config.serverDir) ?? { routes: [], wsRoutes: [] }

    writeFileSync(
      resolve(outputDir, 'worker.mjs'),
      renderCloudflareWorkerEntry({
        ssrStreaming: config.ssrStreaming,
        ...shell,
        securityHeaders: config.security?.headers,
        csrf: config.security?.csrf,
        disallowed: config.security?.disallowed,
        cors: config.security?.cors,
        // #425 — a selector, not a transformer, so it rides as a literal like the values above.
        serialization: config.serialization,
        routes: scanned.routes,
        wsRoutes: scanned.wsRoutes,
      }),
    )

    // 3. Emit wrangler.toml (with nodejs_compat enforced)
    writeFileSync(resolve(cwd, 'wrangler.toml'), renderWranglerToml())

    // eslint-disable-next-line no-console -- CLI build progress
    console.log('\n  ✓ Cloudflare output → .theokit/cloudflare/ + wrangler.toml')
    // eslint-disable-next-line no-console -- CLI build progress
    console.log(
      `${describeDeployedSecurityHeaders({
        target: 'cloudflare',
        securityHeaders: config.security?.headers,
        // Only the streaming worker renders HTML per request, so only it can put
        // the same nonce on the header and on the script tag it emits.
        mintsNonce: config.ssrStreaming,
        documentServedByPlatform: !config.ssrStreaming,
      })}\n`,
    )
  },
}
