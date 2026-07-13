/* eslint-disable security/detect-non-literal-fs-filename --
 * Controller files are walked from the developer's `serverDir/controllers`
 * (a build-time config path), never from HTTP input. No injection vector.
 */
import { readdirSync, type Dirent } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'

import { createDecoratorHandler, isControllerClass } from '@theokit/http'

import { dispatchCsrfWarn } from '../security/csrf-warn-dispatch.js'
import { enforceCsrf, type DisallowedConfig } from '../security/csrf.js'

import { incomingMessageToWebRequest } from './node-request.js'
import { sendError } from './send-response.js'

/** A decorator controller constructor (`@Controller` class). */
type ControllerClass = new (...args: never[]) => object

/** Loads a controller module by absolute path. In dev this is Vite's `ssrLoadModule`
 * (the Task 1.1 swc transform has already compiled the parameter decorators); tests
 * inject `@theokit/http`'s `loadControllerWithSwc`. */
export type ControllerModuleLoader = (absPath: string) => Promise<Record<string, unknown>>

/** A built controller route table exposed as a pure Web-Standard handler. */
export interface ControllerDispatcher {
  /** `null` = no controller route matched — the host owns the miss (404 / fall-through). */
  dispatch(request: Request): Promise<Response | null>
  /** Non-executing route probe — true when a controller route owns `method` + `pathname`. */
  matches(method: string, pathname: string): boolean
}

// State-mutating methods get CSRF, mirroring the file-route pipeline (execute.ts).
const CSRF_PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Recursively collect `*.controller.ts` files under `dir` (absolute paths). */
function findControllerFiles(dir: string): string[] {
  const found: string[] = []
  const walk = (current: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return // dir doesn't exist — no controllers
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.controller.ts')) found.push(full)
    }
  }
  walk(dir)
  return found
}

/**
 * Load every `@Controller` class under `controllersDir` via the injected loader.
 * Non-controller exports are ignored (`isControllerClass` — reused from @theokit/http).
 */
export async function scanControllers(
  controllersDir: string,
  loadModule: ControllerModuleLoader,
): Promise<ControllerClass[]> {
  const files = findControllerFiles(controllersDir)
  const classes: ControllerClass[] = []
  for (const file of files) {
    const mod = await loadModule(file)
    for (const exported of Object.values(mod)) {
      if (typeof exported === 'function' && isControllerClass(exported)) {
        classes.push(exported as ControllerClass)
      }
    }
  }
  return classes
}

/**
 * Scan `controllersDir` and build a Web-Standard dispatcher over the decorator
 * controllers found. Returns `null` when the directory has no controllers, so
 * the host can skip the controller path entirely (zero cost for routes-only apps).
 *
 * Dispatch REUSES @theokit/http's `createDecoratorHandler` (match + `@Param`
 * binding + `@Body` validation + Response building) — never re-implemented (ADR-1).
 */
export async function createControllerDispatcher(opts: {
  controllersDir: string
  loadModule: ControllerModuleLoader
}): Promise<ControllerDispatcher | null> {
  const classes = await scanControllers(opts.controllersDir, opts.loadModule)
  if (classes.length === 0) return null
  const handle = createDecoratorHandler(classes)
  return {
    dispatch: (request) => handle(request),
    matches: (method, pathname) => handle.matches(method, pathname),
  }
}

/** Write a buffered Web `Response` (controllers never stream) to a Node response. */
async function writeControllerResponse(res: ServerResponse, response: Response): Promise<void> {
  const headersBag: Record<string, string> = {}
  for (const [k, v] of response.headers) {
    if (k.toLowerCase() !== 'set-cookie') headersBag[k] = v
  }
  const setCookies = response.headers.getSetCookie()
  if (setCookies.length > 0) res.setHeader('Set-Cookie', setCookies)
  res.writeHead(response.status, headersBag)
  const body = response.body ? await response.text() : ''
  res.end(body || undefined)
}

/**
 * The `api-middleware` fall-through in one call: scan `controllersDir`, build the
 * dispatcher, and serve the request. Builds a body-ful Web `Request` (`@Body`
 * needs the body; the raw stream is undrained at a route miss) and enforces CSRF
 * with the SAME gate file routes use (parity). Returns `true` when a controller
 * handled it (or CSRF blocked it), `false` when there are no controllers OR none
 * matched (the host continues to its own 404). Built per-miss so controller edits
 * reflect via HMR.
 */
export async function dispatchControllerRequest(args: {
  controllersDir: string
  loadModule: ControllerModuleLoader
  req: IncomingMessage
  res: ServerResponse
  csrfMode: 'off' | 'warn' | 'strict'
  disallowed?: DisallowedConfig
  requestId: string
}): Promise<boolean> {
  const { req, res, csrfMode, disallowed, requestId } = args
  const dispatcher = await createControllerDispatcher({
    controllersDir: args.controllersDir,
    loadModule: args.loadModule,
  })
  if (!dispatcher) return false

  const method = (req.method ?? 'GET').toUpperCase()
  const webRequest = incomingMessageToWebRequest(req)
  const pathname = new URL(webRequest.url).pathname

  // CSRF parity: enforce ONLY when a protected-method controller route actually
  // owns this path (probe with the non-executing matcher — never double-dispatch,
  // which would run the handler + its side effects). An unrouted path falls
  // through to the host's own 404, not a 403.
  if (CSRF_PROTECTED_METHODS.has(method) && dispatcher.matches(method, pathname)) {
    const decision = enforceCsrf(
      req,
      csrfMode,
      { warn: dispatchCsrfWarn, path: req.url },
      disallowed,
    )
    if (!decision.allow) {
      sendError(
        res,
        'CSRF_INVALID',
        decision.reason ?? 'CSRF check failed',
        403,
        undefined,
        requestId,
      )
      return true
    }
  }

  const response = await dispatcher.dispatch(webRequest)
  if (response === null) return false
  await writeControllerResponse(res, response)
  return true
}
