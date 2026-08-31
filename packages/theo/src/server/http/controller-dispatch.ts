/* eslint-disable security/detect-non-literal-fs-filename --
 * Controller files are walked from the developer's `serverDir/controllers`
 * (a build-time config path), never from HTTP input. No injection vector.
 */
import { readdirSync, type Dirent } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'

import {
  CONTROLLER_PREFIX,
  createDecoratorHandler,
  getMeta,
  isControllerClass,
  Reflector,
  type ServeAgent,
} from '@theokit/http'

import type { PluginContext } from '../plugin-types.js'
import type { PluginRunner } from '../plugins/plugin-runner.js'
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
interface ControllerDispatcher {
  /** `null` = no controller route matched — the host owns the miss (404 / fall-through). */
  dispatch(request: Request): Promise<Response | null>
  /** Non-executing route probe — true when a controller route owns `method` + `pathname`. */
  matches(method: string, pathname: string): boolean
  /** True when the controller owning `pathname` declared `theokit:csrf-exempt`. */
  isCsrfExempt(pathname: string): boolean
}

// State-mutating methods get CSRF, mirroring the file-route pipeline (execute.ts).
const CSRF_PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * The plugin lifecycle a controller route runs, or a do-nothing stand-in when there is none.
 *
 * A null object rather than an optional runner threaded through four call sites: with `undefined`
 * every stage reads `if (runner && ctx)` and the dispatcher's branch count carries a question that
 * was already answered once. Here the question is answered when the object is built, and the
 * stages below say what they do instead of re-deciding whether to do it.
 *
 * `shortCircuited` from the inert one is always `false`, which is the truth: no hook answered
 * because there were no hooks.
 */
interface ControllerLifecycle {
  onRequest(): Promise<boolean>
  preHandler(): Promise<boolean>
  onError(error: unknown): Promise<void>
  onResponse(): Promise<void>
}

const INERT_LIFECYCLE: ControllerLifecycle = {
  onRequest: () => Promise.resolve(false),
  preHandler: () => Promise.resolve(false),
  onError: () => Promise.resolve(),
  onResponse: () => Promise.resolve(),
}

/**
 * Build the lifecycle for a request a controller OWNS (usetheokit/theokit#607).
 *
 * @param runner - absent for an app that declares no plugins.
 * @param owned - `dispatcher.matches(...)`, the non-executing probe. False means this dispatcher
 *   is about to decline the path, and a hook fired here would run on a request the host is going
 *   to serve some other way — which is how a hook ends up firing twice for one request.
 */
function controllerLifecycle(
  runner: PluginRunner | undefined,
  owned: boolean,
  ctx: PluginContext,
): ControllerLifecycle {
  if (runner === undefined || !owned) return INERT_LIFECYCLE
  return {
    async onRequest() {
      runner.applyDecorations(ctx.ctx)
      return (await runner.runOnRequest(ctx)).shortCircuited
    },
    async preHandler() {
      return (await runner.runPreHandler(ctx)).shortCircuited
    },
    async onError(error: unknown) {
      await runner.runOnError(ctx, error)
    },
    async onResponse() {
      await runner.runOnResponse(ctx)
    },
  }
}

/**
 * A controller declaring that it authenticates by other means, so the CSRF gate has nothing to add.
 *
 * The case this exists for is a webhook. Stripe, GitHub and every other sender authenticate with an
 * HMAC over the request body — stronger than a header, and entirely unrelated to one. None of them
 * will ever send `X-Theo-Action`, so without this a webhook endpoint answers 403 to every real
 * delivery and the only escape is `csrf: 'warn'` for the whole application (theokit#535).
 *
 * DELIBERATELY separate from `theokit:public`. They answer different questions — "may an
 * unauthenticated caller reach this?" and "does this route authenticate by other means?" — and a
 * route can want the first without the second. Conflating them would lift the gate off every public
 * route in the ecosystem as a side effect of a webhook fix.
 *
 * Declared on the CONTROLLER, not the method: the granularity a webhook needs, and it avoids a
 * second path matcher alongside `handle.matches` that could drift from it.
 */
const CSRF_EXEMPT_METADATA = 'theokit:csrf-exempt'

/**
 * Segment-wise, so `api/hooks` never matches `api/hooks-admin`.
 *
 * Split-and-filter rather than a trimming regex: `/^\/+|\/+$/` is quadratic on a pathname of
 * repeated slashes, and a pathname is attacker-supplied (sonarjs/slow-regex). Splitting is linear
 * and `filter(Boolean)` drops the empty segments the leading and trailing slashes produce, which is
 * all the trim was for.
 */
function segments(value: string): string[] {
  return value.split('/').filter(Boolean)
}

function pathOwnedByPrefix(pathname: string, prefix: string): boolean {
  const want = segments(prefix)
  const got = segments(pathname)
  if (want.length === 0 || got.length < want.length) return false
  return want.every((segment, i) => got[i] === segment)
}

/** Recursively collect `*.controller.ts` files under `dir` (absolute paths). */
/**
 * Every `*.controller.ts` under `dir`, recursively. Exported for theokit#123: the build emitter
 * must find exactly the same set the dev dispatcher does, and two independent walks would be two
 * definitions of "a controller" that drift.
 */
export function findControllerFiles(dir: string): string[] {
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
      // theokit#123 — `.mjs` alongside `.ts`. Dev walks the SOURCE tree; production walks the
      // COMPILED tree under `dist/controllers`, where the same files exist as `*.controller.mjs`.
      // One walk for both keeps a single definition of "a controller file"; two would drift, and a
      // file that counts in dev and not in production is exactly the dev/prod split this fixes.
      else if (entry.name.endsWith('.controller.ts') || entry.name.endsWith('.controller.mjs'))
        found.push(full)
    }
  }
  walk(dir)
  return found
}

/** A discovered controller: its source file + the loaded `@Controller` class. */
interface ControllerModule {
  filePath: string
  cls: ControllerClass
  /**
   * The module's full export namespace — theokit#124.
   *
   * Kept alongside the class because it is the ONLY place a `@Body(schema)` regains a name. The
   * schema on `WalkResult.bodySchema` is a runtime `z.ZodType` with no source identifier, but it is
   * the very object this module exported, so matching it back by reference identity recovers the
   * exported name the typed-client codegen needs to write `z.infer<typeof ...>`.
   *
   * Unused by the dispatch path, which needs only the class.
   */
  exports: Readonly<Record<string, unknown>>
}

/**
 * Load every `@Controller` class under `controllersDir` via the injected loader,
 * keeping each class paired with its source file (needed by the typed-client
 * codegen to emit `import type { X } from '<file>'`). Non-controller exports are
 * ignored (`isControllerClass` — reused from @theokit/http).
 */
export async function scanControllerModules(
  controllersDir: string,
  loadModule: ControllerModuleLoader,
): Promise<ControllerModule[]> {
  const files = findControllerFiles(controllersDir)
  const modules: ControllerModule[] = []
  for (const filePath of files) {
    const mod = await loadModule(filePath)
    for (const exported of Object.values(mod)) {
      if (typeof exported === 'function' && isControllerClass(exported)) {
        modules.push({ filePath, cls: exported as ControllerClass, exports: mod })
      }
    }
  }
  return modules
}

/** Load every `@Controller` class under `controllersDir` (classes only). */
async function scanControllers(
  controllersDir: string,
  loadModule: ControllerModuleLoader,
): Promise<ControllerClass[]> {
  const modules = await scanControllerModules(controllersDir, loadModule)
  return modules.map((m) => m.cls)
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
  /** M47 — serves `@Expose`-bound agent routes (theo supplies a `mountAgent`-backed impl). */
  serveAgent?: ServeAgent
}): Promise<ControllerDispatcher | null> {
  const classes = await scanControllers(opts.controllersDir, opts.loadModule)
  if (classes.length === 0) return null
  // No `undeclaredRoutes` pass-through, deliberately (usetheokit/theokit#576). The handler defaults
  // to `'deny'`, and a theokit app cannot ship an undeclared controller anyway — `theokit build`
  // refuses one (#514). What this closes is `theokit dev`, which never runs that gate: an undeclared
  // route now answers 403 there, at the first request, instead of being served until the build
  // catches it. An escape here would only let an app defer a failure it cannot ship past.
  const handle = createDecoratorHandler({ controllers: classes, serveAgent: opts.serveAgent })
  const reflector = new Reflector()

  // Read once at construction: the metadata cannot change between requests, and re-walking every
  // class per request would put a reflection pass on the hot path for a value that never moves.
  const exemptPrefixes = classes
    // `Reflector`, not `Reflect.getMetadata`: the global is only typed where `reflect-metadata`
    // has been imported, and this module does not import it — the dts build fails on it (TS2339).
    // `@SetMetadata` writes through the same store, so the reader is the framework's own.
    .filter((cls) => reflector.getByKey<boolean>(CSRF_EXEMPT_METADATA, cls) === true)
    .map((cls) => {
      const meta = getMeta<{ prefix?: string }>(CONTROLLER_PREFIX, cls)
      return meta?.prefix ?? ''
    })
    .filter((prefix) => prefix !== '')

  return {
    dispatch: (request) => handle(request),
    matches: (method, pathname) => handle.matches(method, pathname),
    isCsrfExempt: (pathname) => exemptPrefixes.some((p) => pathOwnedByPrefix(pathname, p)),
  }
}

/**
 * Write a controller's Web `Response` to a Node response, byte for byte.
 *
 * The body used to be read with `await response.text()`, under a comment asserting that controllers
 * never stream. The comment was true of this path and hid the real problem: `text()` decodes as
 * UTF-8, so every byte >= 0x80 became `U+FFFD`. A payload of all 256 byte values arrived as 512
 * bytes; a 55 296-byte MPEG from `@theokit/plugin-voice` arrived as 76 790 bytes beginning
 * `ef bf bd`. Status 200, correct content-type, plausible length — invisible until someone opens
 * the file. File routes were never affected: `executeRoute` pumps the stream, so this was a silent
 * divergence between two paths meant to be at parity.
 *
 * `arrayBuffer()` fixes it without changing anything else. This path stays BUFFERED, exactly as
 * before — a controller returning a streamed body still has it collected here, so a plugin that
 * promises progressive delivery does not get it through a controller. That is a real limitation and
 * a separate change: making it stream alters when bytes reach the client, which is behaviour beyond
 * the corruption this repairs.
 */
async function writeControllerResponse(res: ServerResponse, response: Response): Promise<void> {
  const headersBag: Record<string, string> = {}
  for (const [k, v] of response.headers) {
    if (k.toLowerCase() !== 'set-cookie') headersBag[k] = v
  }
  const setCookies = response.headers.getSetCookie()
  if (setCookies.length > 0) res.setHeader('Set-Cookie', setCookies)
  res.writeHead(response.status, headersBag)
  // `Buffer.from(ArrayBuffer)` views the bytes as they are. Any string in between is a decode, and
  // a decode of arbitrary bytes is a loss.
  const body = response.body ? Buffer.from(await response.arrayBuffer()) : undefined
  res.end(body !== undefined && body.length > 0 ? body : undefined)
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
  /** M47 — serves `@Expose`-bound agent routes (mountAgent-backed); omit for routes-only apps. */
  serveAgent?: ServeAgent
  /**
   * usetheokit/theokit#607 — the plugin lifecycle a controller route runs.
   *
   * This parameter did not exist, so neither caller could pass one, so a `@Controller` route ran
   * NO hook in either surface: `theokit start` gave it nothing at all, and `theokit dev` gave it
   * only the `onRequest` its middleware happened to fire before matching. An adopter's identity
   * plugin was therefore dead while the boot log reported it registered, and a rate limiter written
   * as a `preHandler` enforced nothing while reading exactly like protection.
   *
   * Omit it for an app with no plugins — the path then costs one `undefined` check.
   */
  pluginRunner?: PluginRunner
}): Promise<boolean> {
  const { req, res, csrfMode, disallowed, requestId, pluginRunner } = args
  const dispatcher = await createControllerDispatcher({
    controllersDir: args.controllersDir,
    loadModule: args.loadModule,
    serveAgent: args.serveAgent,
  })
  if (!dispatcher) return false

  const method = (req.method ?? 'GET').toUpperCase()
  const webRequest = incomingMessageToWebRequest(req)
  const pathname = new URL(webRequest.url).pathname

  /**
   * Whether a controller route owns this path, decided WITHOUT executing anything.
   *
   * The same non-executing probe the CSRF gate below already used, hoisted because the plugin
   * lifecycle needs the identical answer. Every hook is gated on it: this function runs for every
   * unmatched `/api/*` url, so firing a hook before knowing the path is ours would run the
   * lifecycle on requests this dispatcher is about to decline — and the host runs its own for
   * those (`api-middleware.ts`, the "nobody owns it" arm).
   */
  const owned = dispatcher.matches(method, pathname)
  const lifecycle = controllerLifecycle(pluginRunner, owned, {
    request: webRequest,
    response: res,
    ctx: {},
    requestId,
  })

  // #607 — onRequest BEFORE the CSRF gate, mirroring `executeRoute`: a hook that establishes
  // identity must have run before anything decides whether to refuse the caller.
  if (await lifecycle.onRequest()) return true

  // CSRF parity: enforce ONLY when a protected-method controller route actually
  // owns this path (probe with the non-executing matcher — never double-dispatch,
  // which would run the handler + its side effects). An unrouted path falls
  // through to the host's own 404, not a 403.
  if (CSRF_PROTECTED_METHODS.has(method) && owned && !dispatcher.isCsrfExempt(pathname)) {
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

  // #607 — preHandler after the CSRF gate and immediately before the handler, the position it
  // holds in `execute.ts` for a file route. A hook that answers here stops the pipeline.
  if (await lifecycle.preHandler()) return true

  let response: Response | null
  try {
    response = await dispatcher.dispatch(webRequest)
  } catch (err) {
    // Fail loud: the hook observes the failure and the error keeps rising to the host, which owns
    // the 500 envelope. Swallowing it here would give plugins a view the caller does not have.
    await lifecycle.onError(err)
    throw err
  }
  if (response === null) return false
  await writeControllerResponse(res, response)

  // After the response is written, as `executeRoute` and `serveThroughPluginLifecycle` both do.
  await lifecycle.onResponse()
  return true
}
