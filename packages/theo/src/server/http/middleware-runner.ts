/* eslint-disable security/detect-non-literal-fs-filename --
 * Middleware runner. Checks for `serverDir/middleware.ts` + `context.ts`,
 * cached by CR-017. Paths are derived from `serverDir` (cwd-derived). No
 * HTTP input.
 */
import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'

import { WEB_SHAPED_MIDDLEWARE, type MiddlewareHandler } from '../define/define-middleware.js'
import { scanMiddlewares } from '../scan/middleware-scan.js'
import type { LoadModule } from '../scan/module-loader.js'

import { createWebRequestSource } from './node-request.js'
import { writeWebResponseToServerResponse } from './node-web-adapter.js'

export interface MiddlewareResult {
  ctx: unknown
  aborted: boolean
}

// CR-017 fix: in dev `existsSync` + `scanMiddlewares` ran on EVERY request,
// turning a constant filesystem read into per-request overhead. We cache
// the scan result by serverDir. In prod the same scan should be done once
// at boot — `theo build` already emits a manifest, but the dev path uses
// this runtime cache as a defense-in-depth. The cache is invalidated by
// process restart (Vite HMR replaces the module, clearing this map).
interface MiddlewareCacheEntry {
  singleFilePath: string
  singleFileExists: boolean
  dirMiddlewares: string[]
}
const middlewareCache = new Map<string, MiddlewareCacheEntry>()

export function _resetMiddlewareCacheForTests(): void {
  middlewareCache.clear()
}

// Middleware default-export contract: a function (req, res, next).
type MiddlewareFn = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => void | Promise<void>
type ContextFactory = (args: { request: IncomingMessage; response: ServerResponse }) => unknown // Promise<unknown> is structurally `unknown`; one arm covers both.

function getCachedScan(serverDir: string): MiddlewareCacheEntry {
  let cached = middlewareCache.get(serverDir)
  if (!cached) {
    const singleFilePath = join(serverDir, 'middleware.ts')
    cached = {
      singleFilePath,
      singleFileExists: existsSync(singleFilePath),
      dirMiddlewares: scanMiddlewares(serverDir),
    }
    middlewareCache.set(serverDir, cached)
  }
  return cached
}

/**
 * Run a Web-shaped middleware — the one `middleware()` and `defineMiddleware()` produce (#345).
 *
 * This used to REFUSE the shape by name, because the runner could only invoke `(req, res, next)`
 * and calling a Web handler that way hands it `res` as its `next`. Refusing was better than the
 * blank response it replaced, and it was never the end state: the README documented the builder as
 * the way to write middleware, so the documented path was loud instead of silent, but still broken.
 *
 * It runs now because the published contract became the one that fits this model:
 * `(request, context) => Response | void`. No continuation is needed — returning a `Response`
 * answers the request, returning nothing continues — which is exactly what a runner that executes
 * BEFORE routing can honestly offer.
 *
 * The `Request` is built by the same converter the agent and action branches use, so a middleware
 * reads the request the way every other Web-shaped surface in the framework does.
 */
async function runWebShapedMiddleware(
  mw: MiddlewareHandler,
  req: IncomingMessage,
  res: ServerResponse,
  context: Record<string, unknown>,
): Promise<{ shortCircuited: boolean }> {
  const request = createWebRequestSource(req).toRequest()
  const result = await mw(request, context)
  if (!(result instanceof Response)) return { shortCircuited: false }

  // Written here rather than returned upward: a short-circuit that only ABORTED would leave the
  // client with a blank response, which is the failure this whole issue is about.
  await writeWebResponseToServerResponse(result, res)
  return { shortCircuited: true }
}

/** Whether a loaded default export declared the Web-shaped contract. */
function isWebShaped(mw: object): mw is MiddlewareHandler {
  return WEB_SHAPED_MIDDLEWARE in mw
}

/**
 * Run ONE scanned middleware, whichever shape it declared, and say whether the request is over.
 *
 * One dispatcher rather than a branch at each load site: `server/middleware/` and the single
 * `server/middleware.ts` are two entry points to the same semantics, and this file has already
 * watched them drift — the single-file arm kept `refuseIncompatibleShape` only because someone
 * remembered to add it twice.
 */
async function runScannedMiddleware(
  mw: MiddlewareFn,
  req: IncomingMessage,
  res: ServerResponse,
  context: Record<string, unknown>,
): Promise<{ aborted: boolean }> {
  if (isWebShaped(mw)) {
    const { shortCircuited } = await runWebShapedMiddleware(mw, req, res, context)
    return { aborted: shortCircuited }
  }
  const { nextCalled } = await runOneMiddleware(mw, req, res)
  return { aborted: !nextCalled || res.writableEnded }
}

async function runOneMiddleware(
  mw: MiddlewareFn,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<{ nextCalled: boolean }> {
  // Object-held flag avoids TS narrowing `let nextCalled = false` to the
  // literal `false`, which would make `!nextCalled` an "always-truthy"
  // condition under control-flow analysis.
  const state = { nextCalled: false }
  await mw(req, res, () => {
    state.nextCalled = true
  })
  return state
}

export async function runMiddlewareAndContext(
  req: IncomingMessage,
  res: ServerResponse,
  loadModule: LoadModule,
  serverDir: string,
): Promise<MiddlewareResult> {
  const { singleFilePath, singleFileExists, dirMiddlewares } = getCachedScan(serverDir)
  const dirExists = dirMiddlewares.length > 0

  // #345 — what a Web-shaped middleware decorates. Before this, file middleware contributed NOTHING
  // to `ctx` (only `server/context.ts` did), so an app that wanted a middleware to pass a value to
  // a route had nowhere to put it.
  const middlewareCtx: Record<string, unknown> = {}

  // 1. Ambiguity check — both file and directory is a configuration error
  if (singleFileExists && dirExists) {
    throw new Error(
      'Ambiguous middleware configuration: found both server/middleware.ts and server/middleware/ directory. ' +
        'Use one or the other, not both.',
    )
  }

  // 2. Run middleware chain from directory
  if (dirExists) {
    for (const mwPath of dirMiddlewares) {
      const mod = await loadModule(mwPath)
      const mw = mod.default as MiddlewareFn | undefined
      if (typeof mw !== 'function') continue

      // Both shapes run, in FILENAME order. Running one family before the other would make the
      // `01-`/`02-` prefixes mean nothing the moment an app mixed them, and the prefixes are the
      // only ordering contract this directory has.
      const { aborted } = await runScannedMiddleware(mw, req, res, middlewareCtx)
      if (aborted) return { ctx: middlewareCtx, aborted: true }
    }
  }

  // 3. Run single middleware file (backward compat)
  if (singleFileExists) {
    const mod = await loadModule(singleFilePath)
    const mw = mod.default as MiddlewareFn | undefined
    if (typeof mw === 'function') {
      const { aborted } = await runScannedMiddleware(mw, req, res, middlewareCtx)
      if (aborted) return { ctx: middlewareCtx, aborted: true }
    }
  }

  // 4. Create context (if exists), on top of what middleware decorated.
  //
  // The factory wins on a key collision, matching the precedent one layer up: `execute.ts` re-applies
  // plugin decorations over the middleware ctx for the same reason — the later, more specific
  // producer is the one that meant to set it.
  const factoryCtx = await createServerContext(req, res, loadModule, serverDir)
  if (factoryCtx === null || typeof factoryCtx !== 'object') {
    return { ctx: middlewareCtx, aborted: false }
  }
  return { ctx: { ...middlewareCtx, ...(factoryCtx as Record<string, unknown>) }, aborted: false }
}

/**
 * Run ONLY the application's `server/context.ts` factory and return what it produced.
 *
 * Split out of {@link runMiddlewareAndContext} because the agent endpoints need the identity half
 * of that function and must not take the middleware half with it (usetheokit/theokit#365).
 *
 * The split is not a shortcut, it is the whole of what those endpoints can honestly reuse today:
 * middleware here is `(req, res, next)` and contributes NOTHING to `ctx` — only this factory does.
 * So running the chain would buy the policy no identity it does not already get, while adding
 * abort semantics and header side effects to a dispatch branch that has never had them. Running
 * `server/middleware/` on agent URLs is a separate, larger behaviour change; it is not this one.
 */
export async function createServerContext(
  req: IncomingMessage,
  res: ServerResponse,
  loadModule: LoadModule,
  serverDir: string,
): Promise<unknown> {
  const contextPath = join(serverDir, 'context.ts')
  if (!existsSync(contextPath)) return {}
  const mod = await loadModule(contextPath)
  const createContext = mod.createContext as ContextFactory | undefined
  if (typeof createContext !== 'function') return {}
  return await createContext({ request: req, response: res })
}
