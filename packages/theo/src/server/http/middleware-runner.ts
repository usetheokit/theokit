/* eslint-disable security/detect-non-literal-fs-filename --
 * Middleware runner. Checks for `serverDir/middleware.ts` + `context.ts`,
 * cached by CR-017. Paths are derived from `serverDir` (cwd-derived). No
 * HTTP input.
 */
import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'

import { WEB_SHAPED_MIDDLEWARE } from '../define/define-middleware.js'
import { scanMiddlewares } from '../scan/middleware-scan.js'
import type { LoadModule } from '../scan/module-loader.js'

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
 * Refuse, by name, a middleware this runner cannot invoke (usetheokit/theokit#345).
 *
 * `middleware().handle(...).build()` and `defineMiddleware` resolve to
 * `(request: Request, next: (request) => Promise<Response>) => Response`. This runner calls
 * `mw(req, res, next)`, so such a handler receives Node's `req` as its `request` and Node's `res`
 * as its `next`. Calling `next(request)` then calls `res(...)`; returning a `Response` instead
 * leaves this runner's own `next` uncalled, which aborts the request and writes nothing. A blank
 * page from a middleware that reads as correct is the worst of the two.
 *
 * Refusing is not the end state. Converging the three middleware contracts in this repository — the
 * published one, this runner's, and `WebMiddleware` — is a design decision nobody has taken;
 * `web-middleware-runner.ts` records it as deferred. Until it is taken, saying so beats guessing,
 * which is the discipline the route scanner already applies when it rejects a filename it cannot
 * parse instead of parsing it wrongly.
 */
function refuseIncompatibleShape(mw: MiddlewareFn, filePath: string): void {
  if (!(WEB_SHAPED_MIDDLEWARE in mw)) return

  throw new Error(
    `${filePath} default-exports a Web-shaped middleware — ` +
      `\`(request: Request, next) => Response\`, the shape \`middleware()\` and ` +
      `\`defineMiddleware()\` produce. This runner invokes \`(req, res, next)\` with Node's ` +
      `IncomingMessage and ServerResponse, so it cannot call it: the handler would receive ` +
      `\`res\` as its \`next\`.\n\n` +
      `  Export \`(req, res, next)\` instead, and call \`next()\` to continue:\n` +
      `    export default (req, res, next) => { req.headers['x-seen'] = '1'; next() }\n\n` +
      `The Web-shaped contract is not yet reachable from this path. Converging the two is tracked ` +
      `at usetheokit/theokit#345; this refusal exists so the mismatch is loud rather than a blank ` +
      `response.`,
  )
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
      refuseIncompatibleShape(mw, mwPath)

      const { nextCalled } = await runOneMiddleware(mw, req, res)
      if (!nextCalled || res.writableEnded) {
        return { ctx: {}, aborted: true }
      }
    }
  }

  // 3. Run single middleware file (backward compat)
  if (singleFileExists) {
    const mod = await loadModule(singleFilePath)
    const mw = mod.default as MiddlewareFn | undefined
    if (typeof mw === 'function') {
      refuseIncompatibleShape(mw, singleFilePath)
      const { nextCalled } = await runOneMiddleware(mw, req, res)
      if (!nextCalled || res.writableEnded) {
        return { ctx: {}, aborted: true }
      }
    }
  }

  // 4. Create context (if exists)
  return { ctx: await createServerContext(req, res, loadModule, serverDir), aborted: false }
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
