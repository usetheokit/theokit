import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import type { TheoConfig } from '../config/schema.js'
import { parseAssetsMap } from '../core/contracts/module-preloads.js'
import type { SecurityHeadersConfig } from '../core/contracts/security-headers.js'
import { assertServicesUnsupported, readManifest } from '../services/index.js'

import { deployedAgentsFragment, type DeployedAgent } from './deployed-agents.js'
import { renderBakedRoutes, routeRuntimeLines } from './deployed-baked-routes.js'
import { deployedCorsFragment, type DeployedCorsOptions } from './deployed-cors.js'
import { deployedCsrfFragment, type DeployedCsrfOptions } from './deployed-csrf.js'
import { readDocumentShell } from './deployed-document-shell.js'
import { planDeployedPlugins } from './deployed-plugins-module.js'
import {
  deployedRateLimitFragment,
  rateLimitCheckFragment,
  type DeployedRateLimitOptions,
} from './deployed-rate-limit.js'
import {
  deployedRuntimeConfigFragment,
  serverDirLiteral,
  type DeployedRuntimeConfigOptions,
  type DeployedServerDirOptions,
} from './deployed-runtime-config.js'
import { deployedTraceFragment } from './deployed-trace.js'
import { nodeAdapter } from './node.js'
import { describeDeployedSecurityHeaders, securityHeadersDeclarations } from './security-headers.js'
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
// `readDocumentShell` moved to `./deployed-document-shell.js` (B-317): the Vercel target needs the
// same shell, and an adapter importing another adapter is the coupling `deployed-baked-routes.ts`
// was extracted to avoid.

// Re-exported because this module's tests import it from here, and the move is not their subject.
export { readDocumentShell }

/**
 * Read the map `theokit build` emitted, for baking into the worker (B-035).
 *
 * Returns `undefined` — never throws — for an absent or malformed file. A deploy that failed
 * because an optimisation was missing would turn a lost round trip into a broken build, and the
 * worker is correct without it.
 */
export function readAssetsMapForBake(path: string): Record<string, string[]> | undefined {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- `path` is built by the one caller from a fixed `.theokit/client` layout; this returns `undefined` for anything it cannot read
    return parseAssetsMap(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * The baked route-to-chunks map, as worker source (B-035).
 *
 * A literal and not a read, for the same reason the document shell is: a Worker has no filesystem
 * at request time. Emitted only when the build produced a map; otherwise the worker carries
 * nothing about preloads and behaves exactly as before.
 *
 * **It emits the DATA and no longer the code.** An earlier revision emitted a hand-written copy of
 * `injectModulePreloads`, justified by a claim that the worker could not import it. That claim was
 * false — `theokit/server` re-exports from `core/contracts/` and the generated worker already
 * imports that subpath — and the copy drifted within a day: a fix for proxy-form request targets
 * landed in the original and not in the duplicate. The worker now imports the real function, which
 * is the shape `adapters/security-headers.ts` established one directory over for exactly this
 * build-half/runtime-half pair.
 */
/**
 * Whether this worker can preload at all (B-035).
 *
 * ONE predicate, read by the bake, the import and the call. Two conditions for one decision is
 * how the import came to be emitted for a worker that had no map to give it — found at review, in
 * the same change where a copy and its original had already drifted apart.
 *
 * Streaming is required because the other branch serves the document from `env.ASSETS` as a
 * static file and can inject nothing into it.
 */
function preloadsApplyTo(opts: {
  ssrStreaming?: boolean
  assetsMap?: Record<string, string[]>
}): boolean {
  return opts.ssrStreaming === true && opts.assetsMap !== undefined
}

function renderPreloadSupport(assetsMap: Record<string, string[]> | undefined): string {
  if (assetsMap === undefined) return ''
  return `const __THEO_ASSETS_MAP = ${JSON.stringify(assetsMap)}`
}

/**
 * The branch that answers a non-API request: streamed SSR, or the static asset the Worker
 * platform serves. Extracted at review — it is the one decision in this emitter with two whole
 * shapes behind it, and keeping it inline pushed the caller past its line budget.
 */
function renderNonApiBranch(
  opts: NonNullable<Parameters<typeof renderCloudflareWorkerEntry>[0]>,
  preloadsApply: boolean,
): string {
  return opts.ssrStreaming
    ? [
        `      // B-263 — a worker that owns \`/\` also receives \`/robots.txt\` and \`/logo.png\`, because`,
        `      // \`run_worker_first\` in wrangler.toml is what stops the asset handler answering the`,
        `      // document before this code runs. Rendering SSR for those would answer a text file with HTML.`,
        `      //`,
        `      // B-331 — the extension is a PRE-FILTER, no longer the decision. It used to decide: a dot in`,
        `      // the last segment meant "static file", so \`/users/john.doe\`, \`/v1.2/docs\` and`,
        `      // \`/reports/2026.q3\` were handed to a handler that does not have them, and with`,
        `      // \`not_found_handling = "none"\` that is a 404 for a page the app renders.`,
        `      //`,
        `      // Now a miss falls through to SSR, so a wrong guess costs one local lookup instead of the`,
        `      // response. Keeping the pre-filter is what keeps that lookup OFF every ordinary page`,
        `      // request: \`/dashboard\` never touches the binding.`,
        `      //`,
        `      // Still uncovered, and stated rather than implied: a static file with NO extension, such as`,
        `      // a \`public/CNAME\`. The pre-filter never asks for it, so it renders as a document. That`,
        `      // is the pre-existing behaviour and the rarer direction of the two.`,
        `      const lastSegment = url.pathname.slice(url.pathname.lastIndexOf('/') + 1)`,
        `      if (lastSegment.includes('.')) {`,
        `        const staticAssets = env?.ASSETS`,
        `        if (staticAssets === undefined) return notFoundResponse()`,
        `        const hit = await staticAssets.fetch(request)`,
        `        if (hit.status !== 404) return withSecurityHeaders(hit, SECURITY_HEADERS)`,
        `      }`,
        ``,
        `      // T2.3 — streaming SSR for non-API routes`,
        `      // The same primitive \`theokit start\` uses, not a second one:`,
        `      // 16 bytes of Web Crypto entropy, base64.`,
        `      const nonce = generateNonce()`,
        `      return withSecurityHeaders(`,
        `        await renderStreamingWeb(request, {`,
        !preloadsApply
          ? `          htmlHead: ${JSON.stringify(opts.htmlHead ?? '')},`
          : `          htmlHead: injectModulePreloads(${JSON.stringify(opts.htmlHead ?? '')}, __THEO_ASSETS_MAP, new URL(request.url).pathname),`,
        `          htmlTail: ${JSON.stringify(opts.htmlTail ?? '')},`,
        `          nonce,`,
        `        }),`,
        `        buildSecurityHeaders(SECURITY_HEADERS_CONFIG, { production: true }, { nonce }),`,
        `      )`,
      ].join('\n')
    : [
        `      // #412 — the document, served by the worker so it carries the same baseline every`,
        `      // API response carries. It used to return 404 here while wrangler.toml declared a`,
        `      // \`[site]\` bucket nothing read, so the page was missing rather than unprotected.`,
        `      const assets = env?.ASSETS`,
        `      // A wrangler.toml that predates this binding has no ASSETS. Reading .fetch off`,
        `      // undefined would turn every page request into a 500; 404 is what this target`,
        `      // answered before, which is the honest fallback rather than a new failure.`,
        `      if (assets === undefined) return notFoundResponse()`,
        `      return withSecurityHeaders(await assets.fetch(request), SECURITY_HEADERS)`,
      ].join('\n')
}

export function renderCloudflareWorkerEntry(
  opts: {
    ssrStreaming?: boolean
    htmlHead?: string
    htmlTail?: string
    /**
     * B-035 — the route-to-chunks map, baked as a literal for the same reason the shell above
     * is: a Worker has no filesystem at request time. Absent when the build produced no map,
     * and then nothing about preloads is emitted at all.
     */
    assetsMap?: Record<string, string[]>
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
    /**
     * The app's agents, scanned on the build machine (#367).
     *
     * A different scan from `routes` and served by a different function — which is why a worker
     * that only consulted the route table answered every `/api/agents/<name>` with a 404.
     */
    agents?: readonly DeployedAgent[]
    /** B-185 — the app's `server/context.ts`, project-relative, or absent when it declares none. */
    contextModule?: string
    /** WebSocket route files, scanned on the build machine. Only their presence is used (#369). */
    wsRoutes?: readonly string[]
  } & DeployedServerDirOptions &
    DeployedCsrfOptions &
    DeployedCorsOptions &
    DeployedRateLimitOptions = {},
): string {
  // `/@theo/entry-server` is a VITE virtual id (`vite-plugin/index.ts`), and `adapters/node.ts`
  // resolves it by passing it as the vite build's `input`. This file is not bundled by vite: wrangler
  // hands it to esbuild, which has no such module and fails the build before a request is ever sent —
  // measured 2026-09-26 on the first real `wrangler deploy` this repository attempted (B-263).
  //
  // The same build writes the real thing next door. The worker lands at
  // `.theokit/cloudflare/worker.mjs` and the renderer at `.theokit/server/entry-server.js`, so one
  // directory up is the spelling esbuild can follow.
  const streamingImport = opts.ssrStreaming
    ? `import { renderStreamingWeb } from '../server/entry-server.js'`
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
  // Only the streaming branch renders HTML at request time; the other serves the document from
  // `env.ASSETS` as a static file and can inject nothing. Baking the map for it would ship the whole
  // route table as dead weight — found at review, where the emitter was measured declaring it with
  // zero call sites.
  const preloadsApply = preloadsApplyTo(opts)
  const preloadSupport = preloadsApply ? renderPreloadSupport(opts.assetsMap) : ''

  const nonApiBranch = renderNonApiBranch(opts, preloadsApply)

  // CR-006: Workers lack `process.cwd()` and the `node:*` import surface
  // is brittle even under `nodejs_compat`. We use the Web Crypto
  // `crypto.randomUUID()` instead of `node:crypto.randomUUID`, and embed
  // the server directory as a build-time literal instead of resolving via
  // `node:path` at runtime.
  const { routeImports, routeModuleEntries, routeTableEntries } = renderBakedRoutes(
    opts.routes ?? [],
  )
  const runtimeConfig = deployedRuntimeConfigFragment(opts)
  const agentsFragment = deployedAgentsFragment(
    opts.agents === undefined
      ? undefined
      : // B-185 — a Worker has no filesystem, so its identity module is baked exactly like its
        // agents and its routes (ADR 0014). `contextModule` is `undefined` for an app that
        // declares none, and the generator then emits no import for it.
        { kind: 'baked', agents: opts.agents, contextModule: opts.contextModule },
    {
      wrapSecurityHeaders: true,
      // B-185 — bound only when the runtime-config fragment declared the const, which is
      // exactly when a plugins module was emitted. Referencing it otherwise would emit an
      // identifier the entry never declares.
      pluginRunnerExpr:
        opts.runtimeConfigModule === undefined ? undefined : 'await THEO_PLUGIN_RUNNER',
    },
  )

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
    // NEVER the `theokit/server` umbrella. It is deprecated (the package prints so on import) and it
    // is what made the first real `wrangler deploy` fail: bisected 2026-09-26 with a worker whose
    // only line was `import { matchRoute } from 'theokit/server'`, and that alone pulled
    // `@swc/core`'s `.node` native addon into the bundle. workerd cannot load a `.node` at any
    // bundler setting, so it is not a flag away from working (B-263).
    //
    // The narrow subpaths were probed the same way and are clean — `wrangler deploy --dry-run`
    // exit 0, zero swc, zero errors for both. Which symbol lives where was read from the modules
    // rather than grepped, since these indexes use `export *`:
    //
    //   theokit/server/scan   matchRoute, compilePattern
    //   theokit/server/http   executeRoute, extractTraceIdFromRequest, TRACE_HEADER,
    //                         createCorsWebHandler, injectModulePreloads
    !preloadsApply
      ? `import { matchRoute, compilePattern } from 'theokit/server/scan'\nimport { executeRoute, extractTraceIdFromRequest, TRACE_HEADER, createCorsWebHandler } from 'theokit/server/http'`
      : `import { matchRoute, compilePattern } from 'theokit/server/scan'\nimport { executeRoute, extractTraceIdFromRequest, TRACE_HEADER, createCorsWebHandler, injectModulePreloads } from 'theokit/server/http'`,
    `import { createWebShim } from 'theokit/adapters/web-shim'`,
    opts.ssrStreaming
      ? `import { buildSecurityHeaders, generateNonce, withSecurityHeaders } from 'theokit/adapters/security-headers'`
      : `import { buildSecurityHeaders, withSecurityHeaders } from 'theokit/adapters/security-headers'`,
    `// T3.4 — WS bridge for Cloudflare Workers`,
    `import { createCloudflareWsBridge } from 'theokit/adapters/ws-shim'`,
    // B-027 — only when a limit is declared. `createRateLimiterWeb` is used at module scope by the
    // fragment below and was imported by no target but bun, so an entry that declared a limit threw
    // when it LOADED. `resolveClientIpFromRequest` is the forwarded-header fallback, behind
    // `trustProxy`; the primary source is `cf-connecting-ip`, which the Workers runtime writes.
    ...(opts.rateLimit === undefined
      ? []
      : [
          `import { createRateLimiterWeb } from 'theokit/server/rate-limit'`,
          `import { resolveClientIpFromRequest } from 'theokit/server/rate-limit'`,
        ]),
    streamingImport,
    ``,
    ...runtimeConfig.imports,
    ...agentsFragment.imports,
    ...routeImports,
    ``,
    `// CR-006: server directory is a build-time literal — Workers cannot`,
    `// call process.cwd() and resolving paths at runtime returned '/server'.`,
    `const serverDir = ${serverDirLiteral(opts)}`,
    ``,
    ...routeRuntimeLines(routeModuleEntries, routeTableEntries, 'cloudflare'),
    `// #410 — the security baseline \`theokit start\` puts on every response, carried`,
    `// here as a literal because a Worker has no theo.config.ts to read. Same`,
    `// function, same input, so the deployed page and the local one cannot`,
    `// disagree about what the configuration means.`,
    preloadSupport,
    ...securityHeadersDeclarations(opts.securityHeaders),
    ``,
    ...deployedCsrfFragment(opts, 'a Worker'),
    ``,
    ...runtimeConfig.declarations,
    ...agentsFragment.declarations,
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
    ...cloudflareHandleRequestFragment(
      nonApiBranch,
      runtimeConfig.executeRouteSpread,
      agentsFragment.branch,
      agentsFragment.hostBypass,
      opts.rateLimit,
    ),
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
function cloudflareHandleRequestFragment(
  nonApiBranch: string,
  runtimeSpread: string,
  agentBranch: readonly string[],
  /** SI-020 — the condition that keeps an agent card path out of the static-asset branch. */
  hostBypass: string,
  /** B-027 — the declared limit, or `undefined`. Passed rather than read: this fragment is a
   * separate function from `renderCloudflareWorkerEntry`, where `opts` is bound. */
  rateLimit: DeployedRateLimitOptions['rateLimit'],
): string[] {
  return [
    `async function handleRequest(request, url, env) {`,
    `    if (!url.pathname.startsWith('/api/')${hostBypass}) {`,
    nonApiBranch,
    `    }`,
    ``,
    ...agentBranch,
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
    ...deployedRateLimitFragment(
      rateLimit,
      'cloudflare',
      // `cf-connecting-ip` is the RUNTIME's answer and a caller cannot forge it through the edge.
      // A Worker reached directly has none, and then only a declared `trustProxy` produces an
      // address — otherwise `undefined`, which is the named 503 rather than everyone's bucket.
      `request.headers.get('cf-connecting-ip') ?? resolveClientIpFromRequest(request, TRUST_PROXY)`,
      // `request` alone: the handler binds `(request, env, ctx)` and the header is on the request.
      'request',
    ),
    ``,
    `export default {`,
    `  async fetch(request, env, ctx) {`,
    `    const url = new URL(request.url)`,
    ``,
    `    // #409 — the preflight is answered BEFORE anything routes: an OPTIONS the router handles`,
    `    // is an OPTIONS the browser never gets a CORS answer to. The WebSocket upgrade above is`,
    `    // deliberately upstream of it — a 101 is not a CORS-governed response.`,
    `    const preflight = corsPreflight(request)`,
    `    if (preflight !== null) return withSecurityHeaders(preflight, SECURITY_HEADERS)`,
    ...rateLimitCheckFragment(rateLimit, '    ', 'request'),
    ``,
    `    // LCR0103 — the upgrade branch sits BELOW the limiter, and the order is the point.`,
    `    // It used to sit above, under the comment "a 101 carries no document and no script,`,
    `    // so the security baseline does not apply to it". That is true of the security`,
    `    // HEADERS — a document concern — and false of the limiter, which is a resource`,
    `    // concern: a long-lived socket is the most expensive thing this entry hands out, so`,
    `    // the upgrade is the path that most needs a budget, not the one that may skip it.`,
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
    `    return withCors(request, await handleRequest(request, url, env))`,
    `  },`,
    `}`,
  ]
}

/** Where the build writes the stub every alias points at, relative to the project root. */
export const WORKERS_UNSUPPORTED_STUB_PATH = '.theokit/cloudflare/unsupported-on-workers.mjs'

/** What `absentOptionalPeers` needs to know, injectable so the decision is testable without a tree. */
export interface OptionalPeerProject {
  /** The project's own direct dependency names. */
  readonly directDependencies: readonly string[]
  /** The names each dependency declares as `peerDependenciesMeta.<name>.optional === true`. */
  readonly optionalPeersOf: (name: string) => readonly string[]
  /** Whether a name resolves from the project. */
  readonly isInstalled: (name: string) => boolean
}

/**
 * The optional peer dependencies this project does NOT have, which wrangler will try to resolve.
 *
 * A dependency that reaches an optional backend through `import('better-sqlite3')` leaves a
 * statically resolvable specifier in its dist. `nodejs_compat` does not help — these are npm
 * packages, not builtins — so esbuild fails the whole bundle at BUILD time over a module the code
 * only reaches when a consumer asked for that backend and supplied no override.
 *
 * Measured 2026-09-30 on a fresh `create-theokit` scaffold installed from npm: `wrangler deploy`
 * answered `Could not resolve "better-sqlite3"` from `@theokit/sdk/dist/chunk-XZHJYSPB.js:76`, and
 * the scaffold had 28 absent optional peers across four owners.
 *
 * **Derived, never written down.** The first cut of this listed the three names a grep of that dist
 * produced, and was already incomplete — the SDK declares seven optional peers and `@lancedb/lancedb`
 * was not among the three. A list of names here is a second copy of a fact the dependency publishes,
 * and it rots on the release where the dependency adds the eighth.
 *
 * Two filters, both load-bearing:
 *
 * - an INSTALLED optional peer is left alone. The consumer installed it deliberately, and the table
 *   shrinks by itself the day they do.
 * - `@types/*` is skipped: a types package never appears in a runtime import graph.
 *
 * Aliasing a module the worker graph never imports is inert — it changes nothing. That is why this
 * does not try to decide which owners are "server-side"; that judgement is the hardcoding this
 * design removes.
 *
 * @param project the dependency facts, read from the project or injected by a test
 * @returns the names to alias, in first-seen order, each appearing once
 */
export function absentOptionalPeers(project: OptionalPeerProject): string[] {
  const names: string[] = []
  for (const dependency of project.directDependencies) {
    for (const peer of project.optionalPeersOf(dependency)) {
      if (peer.startsWith('@types/')) continue
      if (project.isInstalled(peer)) continue
      if (!names.includes(peer)) names.push(peer)
    }
  }
  return names
}

/**
 * The module every alias resolves to: it throws when the import is actually reached.
 *
 * Reaching it means the code asked for an optional backend and no override was supplied, which is
 * precisely the condition the calling seam exists for. The message names the module and the remedy,
 * because without it the runtime error is about a path inside `.theokit`.
 *
 * @returns the stub's source
 */
/**
 * `absentOptionalPeers` against the project on disk.
 *
 * Separated from the decision so the decision stays testable without a `node_modules` tree, which is
 * the same split `unpublished-pins.ts` makes and for the same reason. A dependency whose manifest
 * cannot be read contributes nothing rather than failing the build: an unreadable manifest is a
 * different problem, and a build that refuses over it would refuse over a shape nobody predicted.
 *
 * @param cwd the project root
 * @returns the names to alias, or an empty list when the project's own manifest cannot be read
 */
export function absentOptionalPeersOnDisk(cwd: string): string[] {
  const require_ = createRequire(resolve(cwd, 'package.json'))
  const readManifestOf = (name: string): Record<string, unknown> | undefined => {
    try {
      return require_(`${name}/package.json`) as Record<string, unknown>
    } catch {
      return undefined
    }
  }

  let own: Record<string, unknown>
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the project's own manifest
    own = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf-8')) as Record<string, unknown>
  } catch {
    return []
  }

  return absentOptionalPeers({
    directDependencies: Object.keys(own.dependencies ?? {}),
    optionalPeersOf: (name) => {
      const meta = readManifestOf(name)?.peerDependenciesMeta as
        | Record<string, { optional?: boolean }>
        | undefined
      return Object.entries(meta ?? {})
        .filter(([, value]) => value.optional === true)
        .map(([peer]) => peer)
    },
    isInstalled: (name) => readManifestOf(name) !== undefined,
  })
}

export function renderWorkersUnsupportedStub(): string {
  return [
    '// Generated by Theo — Cloudflare adapter',
    '//',
    '// Every optional peer dependency this project did not install is aliased here, because',
    '// wrangler resolves a bare dynamic import at BUILD time and a missing one fails the whole',
    '// bundle. Reaching this module means the code asked for an optional backend and no loader',
    '// override was supplied.',
    'throw new Error(',
    "  'An optional dependency was imported on Cloudflare Workers and this project did not install " +
      'it. Supply a loader override for it, or install it and rebuild — the build regenerates the ' +
      "[alias] table in wrangler.toml from what is present.',",
    ')',
    '',
  ].join('\n')
}

export function renderWranglerToml(opts?: {
  ssrStreaming?: boolean
  workersUnsupported?: readonly string[]
}): string {
  return [
    `# Generated by Theo — Cloudflare Workers`,
    `name = "theo-app"`,
    `main = ".theokit/cloudflare/worker.mjs"`,
    `compatibility_date = "2025-09-01"`,
    `compatibility_flags = ["nodejs_compat"]`,
    ``,
    `# #412 — \`[assets]\` with a BINDING, not the legacy \`[site]\` bucket.`,
    `#`,
    `# \`[site]\` uploads to KV and is read through \`kv-asset-handler\` and a`,
    `# \`__STATIC_CONTENT\` binding — neither of which this worker has ever had. So the`,
    `# bucket was declared, uploaded, and consumed by nothing: with ssrStreaming off, a`,
    `# deploy answered 404 for its own page. This binding is what the worker calls.`,
    `[assets]`,
    `directory = ".theokit/client"`,
    `binding = "ASSETS"`,
    `# B-263 — WITHOUT this key Cloudflare's asset handler answers before the worker for any path`,
    `# that matches a file, and \`.theokit/client/index.html\` matches \`/\`. Measured on the first real`,
    `# deploy: \`GET /\` returned 200 with an empty \`<div id="root">\` and NONE of the six security`,
    `# headers, while \`/api/health\` — a path no file matches — was answered by the worker and carried`,
    `# them. The document was coming off the CDN and the code that renders it never ran.`,
    `#`,
    `# The negation keeps the 300-odd hashed build outputs on the CDN path: \`true\` would satisfy the`,
    `# precedence and pay a JS invocation per stylesheet and chunk.`,
    `run_worker_first = ["/*", "!/assets/*"]`,
    ...(opts?.ssrStreaming === true
      ? [
          `# The worker renders every extension-less path itself, so an asset MISS is a genuine 404.`,
          `# \`single-page-application\` here would answer \`/nope.png\` with 200 and an HTML body.`,
          `not_found_handling = "none"`,
        ]
      : [
          `# A client-routed app asks for /dashboard, which is no file, and with streaming off the`,
          `# worker forwards it to ASSETS rather than rendering it. Without this the asset handler`,
          `# 404s a deep link and the SPA never boots.`,
          `not_found_handling = "single-page-application"`,
        ]),
    ``,
    `# B-332 — the [define] "import.meta.url" compensation lived here until 2026-09-28.`,
    `#`,
    `# Cloudflare executes the top-level module during validation, so a dependency that resolves a`,
    `# path at load time refused the whole upload (code 10021). The cause was @theokit/sdk, in`,
    `# internal/providers/catalog-loader.ts, fixed upstream and published in 5.9.2 — measured on the`,
    `# published tarball: 0 of 254 executable files resolve a path at module scope.`,
    `#`,
    `# The floor this framework declares is now ^5.9.2, so the versions that needed the compensation`,
    `# cannot be installed. A declared dependency is the honest form of that requirement;`,
    `# substituting a literal for import.meta.url was the form that also covered the NEXT dependency`,
    `# with the same vice, in silence.`,
    ``,
    `# Environment variables are set via wrangler secret or dashboard`,
    `# Example: wrangler secret put DATABASE_URL`,
    // Emitted only when something is absent: an empty `[alias]` reads as a decision nobody made.
    // After `[assets]` on purpose — TOML tables are positional, so these keys must open their own.
    ...((opts?.workersUnsupported ?? []).length === 0
      ? []
      : [
          ``,
          `# Optional peer dependencies this project did not install, derived from every direct`,
          `# dependency's \`peerDependenciesMeta.<name>.optional\`. Wrangler resolves a bare dynamic`,
          `# import at BUILD time, so one absent module fails the whole bundle over a code path that`,
          `# only runs when a consumer asked for that backend and supplied no override. Measured`,
          `# 2026-09-30 on a fresh scaffold: \`Could not resolve "better-sqlite3"\` from`,
          `# @theokit/sdk/dist, before any request existed.`,
          `#`,
          `# Install one of these and rebuild: it leaves this table, because the build derives it from`,
          `# what is present rather than from a list written here.`,
          `[alias]`,
          ...(opts?.workersUnsupported ?? []).map(
            (name) => `"${name}" = "./${WORKERS_UNSUPPORTED_STUB_PATH}"`,
          ),
        ]),
  ].join('\n')
}

export const cloudflareAdapter: DeployAdapter = {
  // #367 / #369 and `docs/adr/0020`. Wrangler runs esbuild at deploy time, so bundling here
  // twice would be work with no observable effect — validated live 2026-09-26
  // (`records/acceptance/evidence/b263-cloudflare-deploy.txt`). There is still no source tree in
  // a Worker, which is why it bakes.
  readsSourceAtRunTime: false,
  specifiersResolvedBy: 'the-platform',
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
  servesAgents: true,
  appliesConfig: ['securityHeaders', 'csrf', 'disallowed', 'cors', 'serialization', 'plugins'],
  // B-257 — per-invocation: an in-process counter does not survive, so a declared limit needs a durable store.
  enforcesRateLimit: 'with-a-store',

  async build(config: TheoConfig, cwd: string, ctx?: AdapterBuildContext): Promise<void> {
    // Wave 2 (T2.2) — reject polyglot services on this adapter.
    assertServicesUnsupported('cloudflare', readManifest(cwd))

    // 1. Run the standard Node build first (ctx forwarded so nodeAdapter has makeVitePlugins)
    await nodeAdapter.build(config, cwd, ctx)

    const outputDir = resolve(cwd, '.theokit/cloudflare')
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- build-time output directory, derived from the project root
    mkdirSync(outputDir, { recursive: true })

    // 2. Emit Worker entry (now uses the shared web-shim)
    //
    // The document shell is read HERE, after the Node build produced
    // `.theokit/client/index.html`, and inlined into the worker: a Worker has no
    // filesystem at request time. Split on the root div with the same helper the
    // Node server uses (`ssr-setup.ts`), so the two paths cannot disagree about
    // where the shell ends (#343).
    const shell = readDocumentShell(cwd, config.ssrStreaming)
    // B-035 — the route-to-chunks map, read HERE on the build machine for the same reason the
    // shell above is: a Worker has no filesystem at request time. `nodeAdapter.build` ran
    // first, so the map the Node build emitted is on disk by now. Absent map -> nothing about
    // preloads is emitted, and the worker behaves exactly as it did before.
    const assetsMap = readAssetsMapForBake(resolve(cwd, '.theokit', 'client', 'assets-map.json'))

    // #369 — the routes are resolved HERE, on the build machine, for the same reason the document
    // shell above is read here: a Worker has no filesystem at request time, and the worker used to
    // run the scan itself against a directory that does not exist there.
    //
    // The scanner is INJECTED rather than imported: importing it would add an `adapters → server`
    // edge, which is the layering inversion ADR-0001 v3 removed for `vite-plugin` and which
    // `adapters-may-only-depend-on-core-router-services` refuses. An absent scanner emits a worker
    // with no routes rather than falling back to a runtime scan — the fallback IS the defect.
    const scanned = ctx?.scanRoutes?.(config.serverDir) ?? {
      routes: [],
      wsRoutes: [],
      agents: [],
      // B-185 — no provider means no scan, and an app whose context nobody looked for is
      // indistinguishable here from one that has none. Both resolve an anonymous caller, which is
      // the honest answer rather than an invented subject.
      contextModule: undefined,
    }

    const pluginsPlan = planDeployedPlugins(config.plugins, 'cloudflare')
    if (pluginsPlan !== undefined) {
      // Beside the worker, so the emitted import is a sibling. Wrangler bundles from here, which is
      // what lets the static import reach the app's own module at all (#425).
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- build-time write under the project's own `.theokit/cloudflare`
      writeFileSync(resolve(outputDir, 'theo.plugins.mjs'), pluginsPlan.source)
    }

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- build-time write under the project's own `.theokit/cloudflare`
    writeFileSync(
      resolve(outputDir, 'worker.mjs'),
      renderCloudflareWorkerEntry({
        ssrStreaming: config.ssrStreaming,
        // B-315 — LATENT here, not broken: the routes are baked (#369) so the worker never scans,
        // and a live deploy on 2026-09-26 served every route correctly with the wrong literal. It
        // is still handed to `executeRoute`, so it is one refactor away from mattering.
        serverDir: config.serverDir,
        ...shell,
        securityHeaders: config.security?.headers,
        csrf: config.security?.csrf,
        disallowed: config.security?.disallowed,
        cors: config.security?.cors,
        assetsMap,
        // #425 — a selector, not a transformer, so it rides as a literal like the values above.
        serialization: config.serialization,
        // #425 — the ONE concern that is not a literal. A closure cannot be baked, so a plugin
        // declared by module specifier is imported by the emitted module instead; a constructed one
        // is refused by name at build time rather than dropped in silence.
        runtimeConfigModule: pluginsPlan?.moduleSpecifier,
        routes: scanned.routes,
        // #367 — a Worker has no filesystem, so its agents are decided here like its routes.
        agents: scanned.agents,
        // B-185 — rides beside the agents because it is decided by the same provider, for the same
        // reason: `build.ts` holds `serverDir` and a Worker cannot look for the module itself.
        contextModule: scanned.contextModule,
        wsRoutes: scanned.wsRoutes,
      }),
    )

    // 3. Emit the stub every alias resolves to, then wrangler.toml.
    //
    // The stub is written whether or not the table needs it: an alias pointing at a path nothing
    // wrote fails the same way the missing module failed, one layer down, and the file costs nothing.
    const workersUnsupported = absentOptionalPeersOnDisk(cwd)
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- build-time write under the project's own `.theokit/cloudflare`
    writeFileSync(resolve(cwd, WORKERS_UNSUPPORTED_STUB_PATH), renderWorkersUnsupportedStub())

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- build-time write under the project's own `.theokit/cloudflare`
    writeFileSync(
      resolve(cwd, 'wrangler.toml'),
      // B-263 — the toml decides whether the worker or the CDN answers the document, and the two
      // modes need different `not_found_handling`. Passing the flag is what keeps them apart.
      renderWranglerToml({ ssrStreaming: config.ssrStreaming, workersUnsupported }),
    )

    if (workersUnsupported.length > 0) {
      // The COUNT on every build, and the names in the file. Printing all 25 of them — measured on a
      // fresh scaffold — buries the rest of the build output in a list nobody reads twice, and the
      // list is already written where a reader can look it up.
      //
      // eslint-disable-next-line no-console -- CLI build progress
      console.log(
        `  ℹ ${String(workersUnsupported.length)} absent optional peer dependenc${
          workersUnsupported.length === 1 ? 'y' : 'ies'
        } aliased so wrangler can bundle — see [alias] in wrangler.toml`,
      )
    }

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
        // #412 — either way the worker returns the document now: streamed by
        // `renderStreamingWeb`, or from the ASSETS binding it finally calls.
        documentHeaders: 'handler',
      })}\n`,
    )
  },
}
