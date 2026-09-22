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

/**
 * Middleware default-export contract: a function `(req, res, next)` — Express's.
 *
 * **`next` may be called asynchronously**, from a callback or a promise, after the function has
 * returned. That is the dominant Express shape for callback-based I/O and the runner waits for it
 * (B-218); it used to read the flag one microtask after the function returned and report an abort,
 * which left the socket open with nothing written.
 *
 * Exactly one of two things must eventually happen: `next()` is called, or a response is written.
 * Doing NEITHER holds the request open — Express behaves the same way, because there is no third
 * signal to read. This runner names the middleware in a warning after 10s rather than leaving the
 * hang mute.
 */
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
/**
 * Raised when a `server/middleware/*.ts` middleware awaits `next`.
 *
 * Typed rather than a bare `Error` so a caller can tell this apart from a failure inside the
 * middleware's own body — `rules/error-handling.md` § 2, and the same shape as
 * `http/in-process-caller.ts`'s three.
 */
export class MiddlewareNextUnavailableError extends Error {
  constructor() {
    super(
      '`next` is not available in `server/middleware/*.ts`. That path runs BEFORE routing, so it ' +
        'has no downstream response to give you: there is nothing to await and nothing to observe ' +
        'afterwards. Return a `Response` to answer the request, or return nothing to continue. ' +
        'For code that must run AFTER the route, use the Web path — `executeWebRequest`, whose ' +
        'runner passes a `next` that reaches the route (`http/web-middleware-runner.ts`).',
    )
    this.name = 'MiddlewareNextUnavailableError'
  }
}

/**
 * What this runner supplies for `next`, and why it refuses instead of continuing.
 *
 * B-196. `next` used to be OPTIONAL and this runner passed nothing, so the compiler accepted the
 * two-argument call and an author following the type wrote `next?.()` — a SILENT continue. Silence
 * is the failure `rules/error-handling.md` exists to prevent: the middleware appears to work, the
 * code after it never runs, and nothing says so.
 *
 * Refusing is not the end state. `docs/adr/0003`'s amendment of 2026-09-21 leaves two large options
 * open — folding this path so the chain wraps the route, or retiring this contract — after a PLAN
 * panel refuted the premise that the fold is cheap. This change deliberately decides neither; it
 * makes the gap loud and typed so that whichever is chosen replaces a refusal rather than a lie.
 */
const nodePathHasNoDownstream = (): Promise<Response | undefined> => {
  throw new MiddlewareNextUnavailableError()
}

async function runWebShapedMiddleware(
  mw: MiddlewareHandler,
  req: IncomingMessage,
  res: ServerResponse,
  context: Record<string, unknown>,
): Promise<{ shortCircuited: boolean }> {
  const request = createWebRequestSource(req).toRequest()
  const result = await mw(request, context, nodePathHasNoDownstream)
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
 *
 * `refuseIncompatibleShape` NO LONGER EXISTS, and this paragraph keeps its name because the
 * drift it argues against is why the dispatcher is single. It shipped in `095c786d1` and was
 * removed the next day by `ab56b3888`, which records the decision: refusing was "the right
 * interim answer and never the end state", because the README pointed users at a path that did
 * not work. The end state is the convergence below — an incompatible shape can no longer
 * ARRIVE: `isWebShaped` runs the builder's `(request, context)` form and everything else runs
 * the Node `(req, res, next)` form, so both are invocable and there is nothing left to refuse.
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
  // B-218. Decided on EVIDENCE now that the wait above has produced some: `next` was called, or
  // the response was written. Before, "did not call next synchronously" and "has taken
  // responsibility for the response" were treated as one fact.
  return { aborted: !nextCalled || res.writableEnded }
}

/** How long an ambiguous middleware waits before the hang is named rather than mute. */
const SILENT_MIDDLEWARE_WARNING_MS = 10_000

async function runOneMiddleware(
  mw: MiddlewareFn,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<{ nextCalled: boolean }> {
  // Object-held flag avoids TS narrowing `let nextCalled = false` to the
  // literal `false`, which would make `!nextCalled` an "always-truthy"
  // condition under control-flow analysis.
  const state = { nextCalled: false }

  // B-218. `MiddlewareFn` is the Express contract, under which `next` may be invoked from a
  // CALLBACK after the function has returned — the dominant Express shape for callback-based I/O.
  // This used to read the flag immediately after awaiting the middleware, so
  // `function (req, res, next) { fs.readFile(p, () => next()) }` returned synchronously, the flag
  // was still false one microtask later, and the runner reported an abort. The caller then
  // returned from the request handler having written nothing, leaving the socket open until a
  // timeout while the eventual `next()` set a flag nobody read.
  let signalNext!: () => void
  const nextCalled = new Promise<void>((resolve) => {
    signalNext = resolve
  })

  await mw(req, res, () => {
    state.nextCalled = true
    signalNext()
  })

  // Already decided: it continued, or it answered. Nothing to wait for.
  if (state.nextCalled || res.writableEnded) return state

  // Ambiguous, and the two readings are opposite: the middleware is doing I/O and will call
  // `next`, or it has silently given up. Absence is not evidence of either, so wait for one to
  // arrive rather than guessing — which is what Express itself does.
  const signals: Promise<void>[] = [nextCalled, warnAboutSilence(mw)]
  const ended = responseEnded(res)
  if (ended !== undefined) signals.push(ended)
  await Promise.race(signals)
  return state
}

/** Resolves when the response is finished; `undefined` where there is no emitter to ask. */
function responseEnded(res: ServerResponse): Promise<void> | undefined {
  if (typeof res.once !== 'function') return undefined
  return new Promise<void>((resolve) => {
    res.once('finish', resolve)
    res.once('close', resolve)
  })
}

/**
 * Names a hang instead of leaving it mute, then lets the request continue.
 *
 * A middleware that neither answers nor calls `next` is a bug in the middleware, and Express hangs
 * on it too. What Express does not do is hang SILENTLY inside someone else's framework: without
 * this, the operator sees a request that never returns and nothing anywhere says which middleware
 * is holding it. The timer is `unref`'d so it never keeps the process alive.
 */
function warnAboutSilence(mw: MiddlewareFn): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      const named = mw.name === '' ? 'an anonymous middleware' : `\`${mw.name}\``
      console.warn(
        `[theokit] ${named} in server/middleware/ has neither called next() nor written a ` +
          `response after ${String(SILENT_MIDDLEWARE_WARNING_MS)}ms. The request is waiting on it. ` +
          'Call next() to continue, or write a response to answer — doing neither holds the socket open.',
      )
      resolve()
    }, SILENT_MIDDLEWARE_WARNING_MS)
    if (typeof timer.unref === 'function') timer.unref()
  })
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
