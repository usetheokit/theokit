/* eslint-disable security/detect-non-literal-fs-filename --
 * Netlify deploy adapter. All paths derived from `cwd` and a fixed
 * `.theokit/netlify/` output layout. Build-time tool — no HTTP input.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { TheoConfig } from '../config/schema.js'
import type { SecurityHeadersConfig } from '../core/contracts/security-headers.js'
import { assertServicesUnsupported, readManifest } from '../services/index.js'

import {
  bundleDeployedFunction,
  type BundleDeployedFunctionOptions,
} from './bundle-deployed-function.js'
import { deployedAgentsFragment, JSON_NOT_FOUND_RESPONSE } from './deployed-agents.js'
import { renderBakedRoutes, routeRuntimeLines, type BakedRoute } from './deployed-baked-routes.js'
import { type DeployedCorsOptions } from './deployed-cors.js'
import { type DeployedCsrfOptions } from './deployed-csrf.js'
import { deployedEntryPreamble } from './deployed-preamble.js'
import { deployedRateLimitFragment, rateLimitCheckFragment } from './deployed-rate-limit.js'
import type { DeployedRateLimitOptions } from './deployed-rate-limit.js'
import {
  deployedRuntimeConfigFragment,
  type DeployedRuntimeConfigOptions,
  serverDirLiteral,
  type DeployedServerDirOptions,
} from './deployed-runtime-config.js'
import { deployedTraceFragment } from './deployed-trace.js'
import { nodeAdapter } from './node.js'
import { buildSecurityHeaders, describeDeployedSecurityHeaders } from './security-headers.js'
import type { AdapterBuildContext, DeployAdapter } from './types.js'

export class NetlifyConflictError extends Error {
  constructor(path: string, currentTo: string) {
    super(
      `netlify.toml has a conflicting redirect: "${path}" → "${currentTo}". ` +
        `Remove it manually or edit it to point to "/.netlify/functions/theo" ` +
        `before running the Netlify adapter again.`,
    )
    this.name = 'NetlifyConflictError'
  }
}

export class NetlifyFunctionsConflictError extends Error {
  constructor(key: string, declared: string, required: string) {
    super(
      `netlify.toml declares \`[functions] ${key} = "${declared}"\`, and this adapter needs ` +
        `"${required}". Measured on the Netlify emulator: \`directory\` is what makes the generated ` +
        `function discoverable at all (without it the redirect answers "Function not found"), and ` +
        `\`node_bundler = "none"\` is what stops Netlify re-bundling a function theokit already ` +
        `bundled — which produces a SyntaxError. Change the value, or remove the key and let this ` +
        `adapter write it.`,
    )
    this.name = 'NetlifyFunctionsConflictError'
  }
}

export interface NetlifyBuildDeps {
  runNodeBuild?: (config: TheoConfig, cwd: string, ctx?: AdapterBuildContext) => Promise<void>
  writeFile?: (path: string, content: string) => void
  ensureDir?: (path: string) => void
  readTomlIfExists?: () => string | null
  /**
   * Seam for the bundling step, alongside `runNodeBuild` above.
   *
   * The entry cannot be written as source: it imports `theokit/server/scan` and five sibling
   * sub-paths by bare specifier, and Netlify's own bundler breaks on the result (measured on the
   * emulator — see `the-netlify-function-ships-pre-bundled.test.ts`). Bundling here rather than
   * through `writeFile` is what lets the toml then say `node_bundler = "none"`.
   */
  bundleFunction?: (options: BundleDeployedFunctionOptions) => Promise<void>
}

export function renderNetlifyFunction(
  opts: { securityHeaders?: SecurityHeadersConfig } & DeployedCsrfOptions &
    DeployedRuntimeConfigOptions &
    DeployedCorsOptions &
    DeployedRateLimitOptions &
    DeployedServerDirOptions & {
      routes?: readonly BakedRoute[]
      /**
       * The agents, baked at build time — for the same reason the routes are (B-339).
       *
       * Netlify uploads a BUNDLE now, so the runtime scan cannot work here at any value: there is no
       * source tree to read, and `createProductionLoader()` would `import()` a path that was never
       * shipped. Vercel's own comment on this says it best — a fallback "would preserve a behaviour
       * that is broken by construction: an entry that scans, finds nothing, and answers 404 while
       * looking like it tried."
       */
      agents?: readonly { filePath: string; agentPath: string; name: string }[]
      contextModule?: string
    } = {},
): string {
  // B-338 — the routes are baked, not scanned. The scan was a `readdirSync` over the server directory,
  // and on the Netlify emulator it FOUND `src/server/routes/health.ts` and answered 500
  // `SyntaxError: Unexpected token ')'` — a TypeScript source a plain JS runtime cannot compile. On a real
  // deploy it finds nothing at all, because Netlify uploads the bundled function. The fix B-319 made for
  // Vercel and #369 for Cloudflare, on the fourth target; the emitter is shared and its own docblock says
  // "the target only supplies what its own error message says".
  const { routeImports, routeModuleEntries, routeTableEntries } = renderBakedRoutes(
    opts.routes ?? [],
  )
  const runtimeConfig = deployedRuntimeConfigFragment(opts)
  // B-235. Netlify's handler is `(request, context)` and already RECEIVES a Web `Request`, which
  // is the shape this branch needs — the item filed against it counted `new Request` occurrences
  // and concluded the opposite, measuring how the entry OBTAINS a request rather than whether it
  // has one. It used to take `scannedFromLoaderCache` with Deno as the model — same `loaderCache`,
  // same filesystem `serverDir`. That stopped being right when this target began bundling: the
  // emitted `if (!loaderCache) loaderCache = createProductionLoader()` referenced two names the
  // host no longer declared, which is a ReferenceError on the first /api/agents/<name> request and
  // is what `a-generated-entry-declares-every-identifier.test.ts` was written to catch.
  const agentsFragment = deployedAgentsFragment(
    { kind: 'baked', agents: opts.agents ?? [], contextModule: opts.contextModule },
    {
      // Netlify answers its own 404 inline rather than through a helper, so the fragment is given
      // the expression instead of a call it would have to declare.
      notFound: `new Response('Not Found', { status: 404 })`,
    },
  )
  return [
    `// Generated by Theo — Netlify Functions adapter`,
    `import { resolve } from 'node:path'`,
    `import { matchRoute, compilePattern } from 'theokit/server/scan'\nimport { executeRoute, extractTraceIdFromRequest, TRACE_HEADER, createCorsWebHandler } from 'theokit/server/http'`,
    ...routeImports,
    `import { createWebShim } from 'theokit/adapters/web-shim'`,
    `import { buildSecurityHeaders, withSecurityHeaders } from 'theokit/adapters/security-headers'`,
    ``,
    `const cwd = process.cwd()`,
    // B-338 — was `resolve(cwd, 'server')`, a literal. A project declaring `src/server` got a function
    // scanning a directory that does not exist, and every `/api/*` answered 404 — measured on the Netlify
    // emulator. The FOURTH target with this shape: B-185 (bun, deno), B-235 (agentsDir here), B-315
    // (vercel, aws-lambda, cloudflare), and this file's own call site already names two of them.
    `const serverDir = resolve(cwd, ${serverDirLiteral(opts)})`,
    ...routeRuntimeLines(routeModuleEntries, routeTableEntries, 'netlify'),
    ``,
    `// #410 — the security baseline \`theokit start\` puts on every response,`,
    `// carried here as a literal because the deployed function has no`,
    `// theo.config.ts to read. The netlify.toml redirect routes only /api/* here,`,
    `// so this covers the API and not the document Netlify's static host serves`,
    `// (usetheokit/theokit#412).`,
    ...deployedEntryPreamble(runtimeConfig, agentsFragment, opts, 'netlify'),
    ``,
    // B-027 — emitted only when a limit is declared.
    ...(opts.rateLimit === undefined
      ? []
      : [
          // B-338 — the sub-path, not the umbrella. The umbrella re-exports the whole server half and
          // @swc/core's native .node addon is down that graph; the guard against it could not see this
          // adapter, because the shared comment stripper read this file's "/*" redirect glob as a
          // comment opener and deleted 36% of it before the sweep looked.
          `import { createRateLimiterWeb } from 'theokit/server/rate-limit'`,
          `import { resolveClientIpFromRequest } from 'theokit/server/rate-limit'`,
          ``,
        ]),
    ...deployedRateLimitFragment(
      opts.rateLimit,
      'netlify',
      // `context.ip` is the platform's own answer, read from the handler context Netlify passes.
      // The forwarded fallback covers a function shape that carries no context, and returns
      // `undefined` unless a `trustProxy` was declared — which is the named 503, not a shared key.
      `context?.ip ?? resolveClientIpFromRequest(request, TRUST_PROXY)`,
      // Both names are bound in the OUTER handler, which is where the check runs. Threading
      // `context` into `handleRequest` — which the plan called for — buys nothing: the limiter
      // never runs in there.
      'request, context',
    ),
    ``,
    `export default async (request, context) => {`,
    `  // #409 — the preflight is answered BEFORE anything routes: an OPTIONS the router`,
    `  // handles is an OPTIONS the browser never gets a CORS answer to.`,
    `  const preflight = corsPreflight(request)`,
    `  if (preflight !== null) return withSecurityHeaders(preflight, SECURITY_HEADERS)`,
    ...rateLimitCheckFragment(opts.rateLimit, '  ', 'request, context'),
    `  return withCors(request, withSecurityHeaders(await handleRequest(request), SECURITY_HEADERS))`,
    `}`,
    ``,
    `async function handleRequest(request) {`,
    `  const url = new URL(request.url)`,
    `  if (!url.pathname.startsWith('/api/')${agentsFragment.hostBypass}) {`,
    `    return new Response('Not Found', { status: 404 })`,
    `  }`,
    ``,

    ``,
    ...agentsFragment.branch,
    ``,
    `  const match = matchRoute(url.pathname, routes)`,
    `  if (!match) return ${JSON_NOT_FOUND_RESPONSE}`,
    ``,
    `  const { req, res, toResponse } = createWebShim(request)`,
    ...deployedTraceFragment('request', '  '),
    `  const method = request.method.toUpperCase()`,
    `  // #382 — the run is not awaited: toResponse() settles at the headers and`,
    `  // carries a live body, so Netlify streams while the handler writes.`,
    `  return toResponse(executeRoute({ route: match.route, method, params: match.params, req, res, loadModule, serverDir, requestId, ...CSRF_CONFIG, ${runtimeConfig.executeRouteSpread} }))`,
    `}`,
  ].join('\n')
}

const THEO_REDIRECT_FROM = '/api/*'
const THEO_REDIRECT_TO = '/.netlify/functions/theo'

/**
 * TOML merge (EC-2) — non-destructive.
 *
 * We avoid adding a TOML parser dependency by working at the line level. The
 * supported subset is sufficient for the Netlify use case:
 *   - detect existing `[[redirects]]` blocks
 *   - find a block whose `from = "..."` matches our target
 *   - error if such a block points elsewhere
 *   - otherwise append our block
 *
 * Unknown sections (e.g. `[build]`, `[[headers]]`, `[context.production.environment]`)
 * are preserved as-is.
 */
interface NetlifyRedirectBlock {
  startLine: number
  endLine: number
  from?: string
  to?: string
}

function parseRedirectBlocks(lines: readonly string[]): NetlifyRedirectBlock[] {
  const blocks: NetlifyRedirectBlock[] = []
  let current: NetlifyRedirectBlock | null = null

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed === '[[redirects]]') {
      if (current) {
        current.endLine = i - 1
        blocks.push(current)
      }
      current = { startLine: i, endLine: i }
      continue
    }
    if (current && /^\[(\[|[^[])/.test(trimmed)) {
      // Entering another section — close current.
      current.endLine = i - 1
      blocks.push(current)
      current = null
    }
    if (current) {
      const fromMatch = /^from\s*=\s*"([^"]+)"/.exec(trimmed)
      if (fromMatch) current.from = fromMatch[1]
      const toMatch = /^to\s*=\s*"([^"]+)"/.exec(trimmed)
      if (toMatch) current.to = toMatch[1]
      current.endLine = i
    }
  }
  if (current) blocks.push(current)
  return blocks
}

/**
 * The `[functions]` keys this adapter requires, and why each one is not optional.
 *
 * `directory` — measured on the Netlify emulator 2026-09-29: without it the CLI scans its default
 * `netlify/functions/`, finds nothing, and `/api/*` answers `Function not found...` with a 404. The
 * adapter writes to `.netlify/functions/` deliberately (generated output belongs in an ignored
 * directory, not in the source tree the project commits), so the location has to be declared.
 *
 * `node_bundler` — the entry is already bundled here. Netlify re-bundling it produced
 * `SyntaxError: Invalid left-hand side in assignment`.
 */
const THEO_FUNCTIONS_DIR = '.netlify/functions'
const THEO_FUNCTION_NAME = 'theo'
const THEO_FUNCTIONS_KEYS: readonly (readonly [string, string])[] = [
  ['directory', THEO_FUNCTIONS_DIR],
  ['node_bundler', 'none'],
]
const THEO_FUNCTIONS_TARGET = [
  '[functions]',
  ...THEO_FUNCTIONS_KEYS.map(([key, value]) => `  ${key} = "${value}"`),
].join('\n')

const THEO_REDIRECT_TARGET = [
  '[[redirects]]',
  '  from = "/api/*"',
  '  to = "/.netlify/functions/theo"',
  '  status = 200',
  '  force = true',
].join('\n')

/**
 * The client router's fallback: a path that no file and no earlier rule answers gets the document.
 *
 * #949 — measured 2026-10-03 on Netlify production: `GET /about` answered 404 while the same build
 * answered 200 on Vercel and Cloudflare (whose `wrangler.toml` carries `not_found_handling =
 * "single-page-application"` for this). Unforced, so a real file such as `/assets/*.js` still wins,
 * and appended after `/api/*` because Netlify applies the first rule that matches.
 */
const THEO_SPA_FALLBACK_FROM = '/*'
const THEO_SPA_FALLBACK_TARGET = [
  '[[redirects]]',
  '  from = "/*"',
  '  to = "/index.html"',
  '  status = 200',
].join('\n')

/** Append the fallback unless some `/*` rule exists — the project's own wins. */
function withSpaFallback(source: string): string {
  const declared = parseRedirectBlocks(source.split(/\r?\n/)).some(
    (b) => b.from === THEO_SPA_FALLBACK_FROM,
  )
  if (declared) return source
  const sep = source.endsWith('\n') ? '' : '\n'
  return `${source}${sep}\n${THEO_SPA_FALLBACK_TARGET}\n`
}

/**
 * Marks the block this build owns, so it can be REGENERATED rather than merely not duplicated.
 *
 * Idempotence alone would be the wrong contract here: the block carries configuration, so a
 * `security.headers` change has to reach the file. Leaving an existing block in place — which is
 * what the redirect above correctly does, because its content is fixed — would silently pin the
 * baseline to whatever the first build emitted.
 */
const THEO_HEADERS_MARKER = '# Generated by Theo — security baseline (usetheokit/theokit#412)'

/**
 * The `[[headers]]` block telling Netlify's static host the baseline.
 *
 * The emitted function applies these to every response IT returns, and it never returns the HTML
 * document: the `[[redirects]]` block routes only `/api/*`, so the page comes from Netlify's static
 * host and carried none of them. The values come from `buildSecurityHeaders` — the same function
 * the handler calls — rather than being written out here, because two lists of headers that must
 * agree are two lists that eventually do not.
 */
function renderHeadersBlock(securityHeaders: SecurityHeadersConfig | undefined): string {
  const values = buildSecurityHeaders(securityHeaders ?? {}, { production: true })
  return [
    THEO_HEADERS_MARKER,
    '[[headers]]',
    '  for = "/*"',
    '  [headers.values]',
    ...Object.entries(values).map(([k, v]) => `    ${k} = ${JSON.stringify(v)}`),
  ].join('\n')
}

/**
 * Drop a previously generated block, so the next one replaces it.
 *
 * Bounded by the marker and the next top-level section at column 0 (or EOF) — the shape TOML gives
 * a block. A user's own `[[headers]]` is untouched because it does not carry the marker: their
 * file, their rules, and Netlify applies both.
 */
function withoutGeneratedHeaders(source: string): string {
  const lines = source.split(/\r?\n/)
  const start = lines.indexOf(THEO_HEADERS_MARKER)
  if (start < 0) return source

  const opensSection = (line: string | undefined): boolean => (line ?? '').startsWith('[')

  let end = start + 1
  while (end < lines.length && !opensSection(lines[end])) end += 1
  // The marker line itself opens the block, so `end` now sits on the NEXT section — but the block's
  // own `[[headers]]` is the first `[` after the marker, so step past it before scanning again.
  end += 1
  while (end < lines.length && !opensSection(lines[end])) end += 1

  return [...lines.slice(0, start), ...lines.slice(end)].join('\n').replace(/\n{3,}/gu, '\n\n')
}

/**
 * Declare the `[functions]` keys this adapter requires, without emitting a second table.
 *
 * A duplicate table is a TOML parse error, so this is not tidiness: a project that already declares
 * `[functions]` for `directory`, `included_files` or `external_node_modules` must keep it and gain
 * one key. Line-level like the rest of this merge, and for the same reason — no TOML parser
 * dependency. `[functions."name"]` is a DIFFERENT table and is left alone, which is why the match
 * is exact rather than a prefix.
 *
 * An explicit conflicting value is refused rather than overwritten, on the same argument
 * `NetlifyConflictError` makes about a `/api/*` redirect pointing elsewhere: it is a deliberate
 * declaration, and silently replacing it breaks their build for a reason nothing states.
 */
/**
 * Read a TOML scalar exactly as written, with no parser.
 *
 * Neither "strip the quotes" nor "cut at the first #" is correct alone: TOML allows an inline
 * comment after a value, and a `#` INSIDE a quoted value is legal. Stripping quotes alone read
 * `node_bundler = "none"  # keep` as `none"  # keep` and refused a legal file; cutting at `#` alone
 * would mangle `directory = "a#b"`. Both cases are asserted, in both directions, in
 * `the-netlify-function-ships-pre-bundled.test.ts`.
 */
function readTomlScalar(raw: string): string {
  for (const quote of ['"', "'"]) {
    if (!raw.startsWith(quote)) continue
    const close = raw.indexOf(quote, 1)
    return close < 0 ? raw.slice(1) : raw.slice(1, close)
  }
  const hash = raw.indexOf('#')
  return (hash < 0 ? raw : raw.slice(0, hash)).trim()
}

/**
 * The value a key carries inside one table's line range, or `null` when the table does not set it.
 *
 * Split rather than matched: the rest of this merge is line-level by design, and a regex with `\s*`
 * either side of a lazy group backtracks (sonarjs/slow-regex) for no gain here. A commented-out
 * `# node_bundler = …` reads as the key `# node_bundler`, which matches nothing — correct, and free.
 */
function declaredIn(
  lines: readonly string[],
  from: number,
  to: number,
  key: string,
): string | null {
  for (let i = from; i < to; i += 1) {
    const line = lines[i] ?? ''
    const eq = line.indexOf('=')
    if (eq < 0 || line.slice(0, eq).trim() !== key) continue
    return readTomlScalar(line.slice(eq + 1).trim())
  }
  return null
}

function withFunctionsDeclared(source: string): string {
  const lines = source.split(/\r?\n/)
  const at = lines.findIndex((line) => line.trimEnd() === '[functions]')

  if (at < 0) {
    const sep = source.endsWith('\n') ? '' : '\n'
    return `${source}${sep}\n${THEO_FUNCTIONS_TARGET}\n`
  }

  let end = at + 1
  while (end < lines.length && !(lines[end] ?? '').startsWith('[')) end += 1

  const missing: string[] = []
  for (const [key, required] of THEO_FUNCTIONS_KEYS) {
    const declared = declaredIn(lines, at + 1, end, key)
    if (declared === null) {
      missing.push(`  ${key} = "${required}"`)
      continue
    }
    if (declared !== required) throw new NetlifyFunctionsConflictError(key, declared, required)
  }

  if (missing.length === 0) return source
  return [...lines.slice(0, at + 1), ...missing, ...lines.slice(at + 1)].join('\n')
}

export function mergeNetlifyToml(
  existing: string | null,
  securityHeaders?: SecurityHeadersConfig,
): string {
  const headersBlock = renderHeadersBlock(securityHeaders)

  if (existing === null || existing.trim().length === 0) {
    return withFunctionsDeclared(withSpaFallback(`${THEO_REDIRECT_TARGET}\n\n${headersBlock}\n`))
  }

  existing = withoutGeneratedHeaders(existing)

  const blocks = parseRedirectBlocks(existing.split(/\r?\n/))

  // Detect conflict: every `/api/*` block must point at our function.
  for (const b of blocks) {
    if (b.from !== THEO_REDIRECT_FROM) continue
    if (b.to === THEO_REDIRECT_TO) {
      // The redirect is already there. The headers block is regenerated regardless, because it
      // carries configuration and the redirect does not.
      const sep = existing.endsWith('\n') ? '' : '\n'
      return withFunctionsDeclared(withSpaFallback(`${existing}${sep}\n${headersBlock}\n`))
    }
    throw new NetlifyConflictError(b.from, b.to ?? '(unknown)')
  }

  // No conflict — append target block.
  const sep = existing.endsWith('\n') ? '' : '\n'
  return withFunctionsDeclared(
    withSpaFallback(`${existing}${sep}\n${THEO_REDIRECT_TARGET}\n\n${headersBlock}\n`),
  )
}

/**
 * Resolve the build's effective dependencies once.
 *
 * Extracted when `buildNetlify` crossed the complexity ceiling after B-339 added a fifth seam. The
 * defaults are a separate concern from the build's sequence (SRP), and the sequence is the part a
 * reader comes here to follow.
 */
function resolveNetlifyDeps(
  cwd: string,
  deps: NetlifyBuildDeps,
): {
  runNodeBuild: NonNullable<NetlifyBuildDeps['runNodeBuild']>
  writeFile: NonNullable<NetlifyBuildDeps['writeFile']>
  ensureDir: NonNullable<NetlifyBuildDeps['ensureDir']>
  readTomlIfExists: NonNullable<NetlifyBuildDeps['readTomlIfExists']>
  bundleFunction: NonNullable<NetlifyBuildDeps['bundleFunction']>
} {
  return {
    runNodeBuild: deps.runNodeBuild ?? nodeAdapter.build.bind(nodeAdapter),
    writeFile:
      deps.writeFile ??
      ((path, content) => {
        writeFileSync(path, content)
      }),
    ensureDir: deps.ensureDir ?? ((path: string) => mkdirSync(path, { recursive: true })),
    readTomlIfExists:
      deps.readTomlIfExists ??
      (() => {
        const path = resolve(cwd, 'netlify.toml')
        return existsSync(path) ? readFileSync(path, 'utf-8') : null
      }),
    bundleFunction: deps.bundleFunction ?? bundleDeployedFunction,
  }
}

export async function buildNetlify(
  config: TheoConfig,
  cwd: string,
  deps: NetlifyBuildDeps = {},
  ctx?: AdapterBuildContext,
): Promise<void> {
  // Wave 2 (T2.2) — reject polyglot services on this adapter.
  assertServicesUnsupported('netlify', readManifest(cwd))

  const { runNodeBuild, writeFile, ensureDir, readTomlIfExists, bundleFunction } =
    resolveNetlifyDeps(cwd, deps)

  const merged = mergeNetlifyToml(readTomlIfExists(), config.security?.headers)

  await runNodeBuild(config, cwd, ctx)

  const scanned = ctx?.scanRoutes?.(config.serverDir)

  const fnDir = resolve(cwd, THEO_FUNCTIONS_DIR)
  ensureDir(fnDir)
  // B-339 — bundled, not written as source. The entry imports `theokit/server/scan` and five
  // sibling sub-paths by bare specifier; Netlify's own bundler produced a `ReferenceError` on
  // an identifier that was base64 of the source, and re-bundled an already-bundled file into a
  // `SyntaxError`. Measured on the emulator: bundled here plus `node_bundler = "none"` below,
  // `GET /api/health` answers 200. Cloudflare and Vercel already bundle; this was the target
  // shipping raw source and trusting the platform to resolve it.
  await bundleFunction({
    projectRoot: cwd,
    entrySource: renderNetlifyFunction({
      routes: scanned?.routes,
      // B-339 — from the same scan as the routes, for the same reason: this target bundles, so a
      // runtime agents scan has no source tree to read.
      agents: scanned?.agents,
      contextModule: scanned?.contextModule,
      securityHeaders: config.security?.headers,
      // B-235 wired `agentsDir` through to this renderer, and B-339 made it unreadable here: the
      // agents are baked from the BUILD's scan now, so the entry never resolves a directory. An
      // option a renderer accepts and ignores is the defect `rules/foreign-config-surfaces.md` is
      // about, so it is dropped rather than left looking wired. The scan the build performs still
      // honours `config.agentsDir` — that is where the option belongs.
      // B-338 — the same pillar as the comment above, one option over. The sweep in
      // `every-deployed-entry-is-told-its-server-dir.test.ts` could not see this adapter: its
      // population was the adapters that CALL `serverDirLiteral(opts)`, so the one that never
      // adopted it was outside the population the case iterates.
      serverDir: config.serverDir,
      csrf: config.security?.csrf,
      disallowed: config.security?.disallowed,
      cors: config.security?.cors,
      // #425 — a selector, not a transformer, so it rides as a literal like the values above.
      serialization: config.serialization,
    }),
    stagePath: '.theokit/netlify/entry.mjs',
    // A DIRECTORY, not a bare file. The bundler code-splits: this project emitted `theo.mjs` plus
    // 40 chunks under `assets/`, which `theo.mjs` imports. Netlify zips a directory-shaped function
    // whole, so the chunks travel; a bare `theo.mjs` with a sibling `assets/` loads in `netlify dev`
    // (it reads from disk) and would reach a deploy without them. Vercel already uses a dedicated
    // `functions/api.func` for the same reason.
    outDir: resolve(fnDir, THEO_FUNCTION_NAME),
    entryFileName: `${THEO_FUNCTION_NAME}.mjs`,
  })

  writeFile(resolve(cwd, 'netlify.toml'), merged)

  // eslint-disable-next-line no-console -- CLI build progress
  console.log(`\n  ✓ Netlify output → ${THEO_FUNCTIONS_DIR}/${THEO_FUNCTION_NAME}/ + netlify.toml`)
  // eslint-disable-next-line no-console -- CLI build progress
  console.log(
    `${describeDeployedSecurityHeaders({
      target: 'netlify',
      securityHeaders: config.security?.headers,
      mintsNonce: false,
      documentHeaders: 'platform-configured',
    })}\n`,
  )
}

export const netlifyAdapter: DeployAdapter = {
  // B-339 / B-341 / B-343 — measured on the Netlify emulator. Its own bundler turned the raw
  // source into a `ReferenceError`, and re-bundled an already-bundled file into a `SyntaxError`;
  // the toml declares `node_bundler = "none"` so the bundle this adapter produces ships intact.
  readsSourceAtRunTime: false,
  specifiersResolvedBy: 'this-adapter',
  name: 'netlify',
  streamsResponses: true,
  // #409 / #410 — the generated entry calls `executeRoute` with routes, loader
  // and serverDir only. CSRF, route policy, file middleware and Zod validation
  // still run because they live inside `executeRoute`; none of the remaining
  // configurable concerns reach it. Declared explicitly rather than omitted so
  // the gap is a statement in the source and not an absence.
  //
  // `securityHeaders` IS applied -- to every response this function returns.
  // The document is served by Netlify's static host and does not pass through
  // it (usetheokit/theokit#412).
  appliesConfig: ['securityHeaders', 'csrf', 'disallowed', 'cors', 'serialization'],
  // B-257 — per-invocation: an in-process counter does not survive, so a declared limit needs a durable store.
  enforcesRateLimit: 'with-a-store',
  build(config, cwd, ctx) {
    return buildNetlify(config, cwd, {}, ctx)
  },
}
