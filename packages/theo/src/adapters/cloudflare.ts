/* eslint-disable security/detect-non-literal-fs-filename --
 * Cloudflare deploy adapter. All write paths are under `cwd/.theokit/cloudflare/`
 * and `cwd/wrangler.toml`. Build-time tool — no HTTP input.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { TheoConfig } from '../config/schema.js'
import { findRootDiv } from '../core/contracts/find-root-div.js'
import type { SecurityHeadersConfig } from '../server/security/security-headers.js'
import { assertServicesUnsupported, readManifest } from '../services/index.js'

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

export function renderCloudflareWorkerEntry(
  opts: {
    ssrStreaming?: boolean
    htmlHead?: string
    htmlTail?: string
    securityHeaders?: SecurityHeadersConfig
  } = {},
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
    `import { scanServerRoutes, matchRoute, executeRoute, createProductionLoader, scanWebSocketRoutes } from 'theokit/server'`,
    `import { createWebShim } from 'theokit/adapters/web-shim'`,
    opts.ssrStreaming
      ? `import { buildSecurityHeaders, generateNonce, withSecurityHeaders } from 'theokit/adapters/security-headers'`
      : `import { buildSecurityHeaders, withSecurityHeaders } from 'theokit/adapters/security-headers'`,
    `// T3.4 — WS bridge for Cloudflare Workers`,
    `import { createCloudflareWsBridge } from 'theokit/adapters/ws-shim'`,
    streamingImport,
    ``,
    `// Cold-start cache (avoid scanning routes on every request)`,
    `let routesCache = null`,
    `let wsRoutesCache = null`,
    `let loaderCache = null`,
    `// CR-006: server directory is a build-time literal — Workers cannot`,
    `// call process.cwd() and resolving paths at runtime returned '/server'.`,
    `const serverDir = 'server'`,
    ``,
    `// #410 — the security baseline \`theokit start\` puts on every response, carried`,
    `// here as a literal because a Worker has no theo.config.ts to read. Same`,
    `// function, same input, so the deployed page and the local one cannot`,
    `// disagree about what the configuration means.`,
    `const SECURITY_HEADERS_CONFIG = ${renderSecurityHeadersConfigLiteral(opts.securityHeaders)}`,
    `const SECURITY_HEADERS = buildSecurityHeaders(SECURITY_HEADERS_CONFIG, { production: true })`,
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
    `async function handleRequest(request, url) {`,
    `    if (!url.pathname.startsWith('/api/')) {`,
    nonApiBranch,
    `    }`,
    ``,
    `    if (!routesCache) routesCache = scanServerRoutes(serverDir)`,
    `    if (!loaderCache) loaderCache = createProductionLoader()`,
    ``,
    `    const match = matchRoute(url.pathname, routesCache)`,
    `    if (!match) return notFoundResponse()`,
    ``,
    `    const { req, res, toResponse } = createWebShim(request, { trustedProxy: 'platform' })`,
    `    const requestId = crypto.randomUUID()`,
    `    const method = request.method.toUpperCase()`,
    `    // #382 — the run is NOT awaited before the Response is taken. toResponse()`,
    `    // settles as soon as status + headers are known and carries a live body, so`,
    `    // the Worker starts flushing while the handler is still writing. Awaiting`,
    `    // executeRoute() first would re-buffer the whole response here even though`,
    `    // the shim streams; awaiting toResponse() does not — it settles at the head.`,
    `    return withSecurityHeaders(await toResponse(executeRoute({`,
    `      route: match.route, method, params: match.params,`,
    `      req, res, loadModule: loaderCache, serverDir, requestId,`,
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
    `      if (!wsRoutesCache) wsRoutesCache = scanWebSocketRoutes(serverDir)`,
    `      if (wsRoutesCache.length === 0) return notFoundResponse()`,
    `      const cfWs = createCloudflareWsBridge({`,
    `        onOpen: () => {},`,
    `        onMessage: (ws, data) => { ws.send(data) },`,
    `        onClose: () => {},`,
    `      })`,
    `      return cfWs.handle(request)`,
    `    }`,
    ``,
    `    return handleRequest(request, url)`,
    `  },`,
    `}`,
  ].join('\n')
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
  appliesConfig: ['securityHeaders'],

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
    writeFileSync(
      resolve(outputDir, 'worker.mjs'),
      renderCloudflareWorkerEntry({
        ssrStreaming: config.ssrStreaming,
        ...shell,
        securityHeaders: config.security?.headers,
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
