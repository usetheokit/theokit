/* eslint-disable security/detect-non-literal-fs-filename --
 * All filesystem inputs in this file are derived from:
 *   - `process.cwd()` resolved at build time, OR
 *   - directory tree walks rooted in `serverDir`/`appDir` (themselves
 *     resolved from cwd), OR
 *   - file paths produced by `collectStaticPaths` (a controlled router
 *     scanner).
 * No path here originates from HTTP input, environment variables, or
 * deserialized user data. The path-traversal vector the rule guards
 * against does not apply — this is a build-time tool, not a request
 * handler.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { TheoConfig } from '../config/schema.js'
import { findRootDiv } from '../core/contracts/find-root-div.js'
import { scanRoutes } from '../router/scan.js'
import type { RouteNode } from '../router/types.js'
import { assertServicesUnsupported, readManifest } from '../services/index.js'

import { nodeAdapter } from './node.js'
import {
  collectStaticPaths,
  type CollectOptions,
  type LoadStaticPaths,
  type ResolvedPath,
} from './static-paths.js'
import type { AdapterBuildContext, DeployAdapter } from './types.js'

/** Keeps this call site's `RegExpExecArray`-shaped usage while ignoring commented mentions. */
function findRootDivLegacyShape(html: string): [string] | null {
  const found = findRootDiv(html)
  return found ? [found.tag] : null
}

export class StaticApiRoutesDetectedError extends Error {
  constructor(routes: string[]) {
    super(
      `Static adapter cannot build a project with API routes. Found: ${routes.join(
        ', ',
      )}. Use 'node', 'vercel', 'cloudflare' or another runtime adapter.`,
    )
    this.name = 'StaticApiRoutesDetectedError'
  }
}

export class StaticRenderError extends Error {
  constructor(url: string, cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause)
    super(`SSR render failed for ${url}: ${causeMsg}`)
    this.name = 'StaticRenderError'
    if (cause instanceof Error) {
      this.cause = cause
    }
  }
}

export interface StaticBuildDeps {
  detectApiRoutes?: (serverDir: string) => string[]
  scanAppRoutes?: (appDir: string) => RouteNode
  collectPaths?: (tree: RouteNode, options: CollectOptions) => Promise<ResolvedPath[]>
  loadStaticPaths?: LoadStaticPaths
  renderHtml?: (url: string, cwd: string) => Promise<string>
  ensureDir?: (path: string) => Promise<void>
  writeFile?: (path: string, content: string) => Promise<void>
  runNodeBuild?: (config: TheoConfig, cwd: string, ctx?: AdapterBuildContext) => Promise<void>
}

export function detectApiRoutes(serverDir: string): string[] {
  const routesDir = resolve(serverDir, 'routes')
  if (!existsSync(routesDir)) return []
  if (!statSync(routesDir).isDirectory()) return []

  const out: string[] = []
  walkRoutes(routesDir, routesDir, out)
  return out
}

function walkRoutes(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      walkRoutes(root, full, out)
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      const rel = relative(root, full).split(/[\\/]/).join('/')
      out.push(rel)
    }
  }
}

/* eslint-disable @typescript-eslint/require-await -- DI contract is async; default impl uses sync fs */

// The DI surface exposes async helpers (so consumers can override with
// real async IO — e.g. S3 uploads). The defaults use sync fs because
// every caller awaits the result anyway.
const defaultEnsureDir = async (path: string): Promise<void> => {
  mkdirSync(path, { recursive: true })
}

const defaultWriteFile = async (path: string, content: string): Promise<void> => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/* eslint-enable @typescript-eslint/require-await */

/**
 * Default loader: dynamic-imports the file at `paramsFilePath` and invokes
 * its default export. Returns null if the file does not exist (the caller
 * will throw StaticPathsRequiredError with a clear message in that case).
 */
const defaultLoadStaticPaths: LoadStaticPaths = async (paramsFilePath) => {
  if (!existsSync(paramsFilePath)) return null
  try {
    const mod = (await import(pathToFileURL(paramsFilePath).href)) as {
      default?: LoadStaticPaths | (() => Awaited<ReturnType<LoadStaticPaths>>)
    }
    if (typeof mod.default !== 'function') return null
    // The user's `static-paths.ts` may export `default` as either sync or
    // async — `await` accepts both, but ESLint's `await-thenable` cannot
    // see through the union.
    const value = mod.default(paramsFilePath)
    const result = value instanceof Promise ? await value : value
    return result ?? null
  } catch {
    return null
  }
}

/**
 * Default renderer: loads the built SSR entry (`.theokit/server/entry-server.js`)
 * and calls its `render(url)` export, wrapping the result in the client
 * `index.html` template. Falls back to a minimal HTML shell when no SSR build
 * is present (so the static adapter still emits something usable even without
 * SSR enabled).
 */
/**
 * Serialize the router's hydration data the way the server paths do.
 *
 * Without it a static export ships markup the client router cannot adopt, so it
 * re-fetches on load everything the export already contains. `<` is escaped
 * because the only sequence that can break out of a script element is `</script`.
 */
function hydrationScript(hydrationData: unknown): string {
  const json = JSON.stringify(hydrationData).replace(/</g, '\\u003c')
  return `<script>window.__staticRouterHydrationData=${json}</script>`
}

function createDefaultRenderHtml(cwd: string): (url: string) => Promise<string> {
  return async (url: string): Promise<string> => {
    const clientDir = resolve(cwd, '.theokit/client')
    const indexPath = resolve(clientDir, 'index.html')
    const ssrEntryPath = resolve(cwd, '.theokit/server/entry-server.js')

    let baseHtml = '<!doctype html><html><body><div id="root"></div></body></html>'
    if (existsSync(indexPath)) {
      baseHtml = readFileSync(indexPath, 'utf-8')
    }

    if (!existsSync(ssrEntryPath)) {
      // No SSR build — emit the client shell. Hydration on the client will
      // render the route once JS loads. Acceptable degradation when the user
      // chose static + ssr: false.
      return baseHtml
    }

    try {
      // The generated entry returns `{ html, hydrationData }` — see
      // `router/entry-server.ts`, where `render` resolves with that object. This
      // caller typed it as `string | { redirect }` and tested `typeof result ===
      // 'string'`, which has been false for as long as the contract has held. So
      // the render branch was dead and EVERY page fell through to the redirect
      // fallback below: `build --target static` emitted a meta refresh for the
      // whole site, and `/index.html` refreshed to itself
      // (usetheokit/theokit#362). The other two callers were updated when the
      // contract changed; this one was missed, and no test could see it because
      // every existing test injects `renderHtml` over this function.
      // `render` is typed as returning `unknown` and narrowed below, deliberately.
      // The previous declaration asserted a union the module does not honour, and
      // TypeScript then proved a branch dead that was in fact the live one. A
      // dynamically imported artifact is not a thing this file can typecheck, and
      // saying so keeps the narrowing honest rather than decorative.
      const mod = (await import(pathToFileURL(ssrEntryPath).href)) as {
        render?: (u: string) => Promise<unknown>
      }
      if (typeof mod.render !== 'function') return baseHtml
      const result: unknown = await mod.render(url)

      if (result !== null && typeof result === 'object' && 'redirect' in result) {
        // A genuine redirect. Static hosting cannot send a 3xx, so a meta refresh
        // is the honest degradation — for THIS case, which is the only one it was
        // ever meant to cover.
        return `<!doctype html><meta http-equiv="refresh" content="0; url=/" />`
      }

      const shape = result as { html?: unknown; hydrationData?: unknown }
      // Only a string `html` is used. Anything else means the entry returned a
      // shape this adapter does not understand, and emitting `[object Object]`
      // into a published page would be worse than emitting the shell.
      let rendered = ''
      if (typeof result === 'string') rendered = result
      else if (typeof shape.html === 'string') rendered = shape.html
      const hydration =
        typeof result === 'string' || shape.hydrationData === undefined
          ? ''
          : hydrationScript(shape.hydrationData)

      const rootMatch = findRootDivLegacyShape(baseHtml)
      if (rootMatch) {
        const splitIdx = baseHtml.indexOf(rootMatch[0]) + rootMatch[0].length
        return baseHtml.slice(0, splitIdx) + rendered + hydration + baseHtml.slice(splitIdx)
      }
      return baseHtml.replace('</body>', rendered + hydration + '</body>')
    } catch (err) {
      throw new StaticRenderError(url, err)
    }
  }
}

export async function buildStatic(
  config: TheoConfig,
  cwd: string,
  deps: StaticBuildDeps = {},
  ctx?: AdapterBuildContext,
): Promise<void> {
  // Wave 2 (T2.2) — reject polyglot services on this adapter.
  assertServicesUnsupported('static', readManifest(cwd))

  const detect = deps.detectApiRoutes ?? detectApiRoutes
  const apiRoutes = detect(resolve(cwd, 'server'))
  if (apiRoutes.length > 0) {
    throw new StaticApiRoutesDetectedError(apiRoutes)
  }

  const runNodeBuild = deps.runNodeBuild ?? nodeAdapter.build.bind(nodeAdapter)
  await runNodeBuild(config, cwd, ctx)

  const scan = deps.scanAppRoutes ?? scanRoutes
  // #95 — honor config `appDir` (default "app") so `--target static` prerenders a custom frontend dir.
  // `config` is a fully-loaded TheoConfig (loadConfig applied the schema default), so appDir is present.
  const appDir = resolve(cwd, config.appDir)
  const tree = scan(appDir)

  const loadStaticPaths = deps.loadStaticPaths ?? defaultLoadStaticPaths
  const collect = deps.collectPaths ?? collectStaticPaths
  const paths = await collect(tree, { appDir, loadStaticPaths })

  if (paths.length === 0) return

  const renderHtml = deps.renderHtml ?? createDefaultRenderHtml(cwd)
  const ensureDir = deps.ensureDir ?? defaultEnsureDir
  const writeFile = deps.writeFile ?? defaultWriteFile

  const outDir = resolve(cwd, '.theokit/static')
  await ensureDir(outDir)

  for (const path of paths) {
    let html: string
    try {
      html = await renderHtml(path.url, cwd)
    } catch (err) {
      throw new StaticRenderError(path.url, err)
    }
    const outPath = resolve(outDir, path.filename)
    await writeFile(outPath, html)
  }
}

export const staticAdapter: DeployAdapter = {
  name: 'static',
  // #382 — no server at all; there is nothing to stream from.
  streamsResponses: false,
  build(config, cwd, ctx) {
    return buildStatic(config, cwd, {}, ctx)
  },
}
