/* eslint-disable security/detect-non-literal-regexp --
 * Route patterns like /cats/:id are converted to regex at startup —
 * NOT from user HTTP input. The patterns come from decorator metadata
 * authored by the developer. No injection vector.
 */
import 'reflect-metadata'

import type { ExposeOptions } from '../decorators/expose.js'
import type { ParamEntry } from '../decorators/params.js'
import { digestError } from '../error-digest.js'
import { ForbiddenException } from '../exceptions/http-exception.js'

import { resolveOrNew, type DiContainer } from './di-resolve.js'
export type { DiContainer } from './di-resolve.js'
import { runExceptionFilters } from './exception-filter-chain.js'
import {
  createExecutionContext,
  type CanActivate,
  type ExecutionContext,
} from './execution-context.js'
import { runInterceptors } from './interceptor-chain.js'
import {
  MiddlewareConsumerImpl,
  runMiddleware,
  type ResolvedMiddleware,
} from './middleware-consumer.js'
import { resolveBody } from './resolve-body.js'
import { createNodeAdapter } from './runtime/node.js'
import { walkControllerMetadata, type WalkResult } from './walk-metadata.js'

/**
 * M47 — serves an `@Expose`-bound agent route. http is agent-runtime agnostic (G1/G2): it invokes this
 * injected callback (theo supplies a `mountAgent`-backed impl) instead of calling a controller method.
 */
export type ServeAgent = (
  agent: unknown,
  request: Request,
  opts: ExposeOptions,
) => Promise<Response>

export interface CreateDecoratorServerOptions {
  controllers: Function[]
  container?: DiContainer
  configure?: (consumer: MiddlewareConsumerImpl) => void
  /** M47 — required when any controller `@Expose`-binds an agent; serves the agent route. */
  serveAgent?: ServeAgent
}

/**
 * A pure Web-Standard controller handler: callable as `(request) => Response | null`
 * plus a non-executing `matches(method, pathname)` route probe (so a host can gate
 * — e.g. CSRF — before dispatch runs a handler).
 */
export interface DecoratorHandler {
  (request: Request): Promise<Response | null>
  /** True when a controller route owns `method` + `pathname` (no handler executed). */
  matches(method: string, pathname: string): boolean
}

/** Why a controller never came into existence, and which one (#577). */
interface ControllerConstructionFailure {
  controllerName: string
  error: unknown
}

/**
 * One matchable route: its metadata, and EITHER the controller instance that serves it OR the
 * failure that stopped that controller being built (#577).
 *
 * A union rather than two optional fields, so the exclusivity is a property of the type instead of
 * a sentence in a comment: `'failure' in entry` narrows the other arm to a non-optional `instance`,
 * and no reachable state has both or neither.
 */
type RouteEntry =
  | { walk: WalkResult; instance: object }
  | { walk: WalkResult; failure: ControllerConstructionFailure }

/**
 * Build a pure Web-Standard request handler from decorated controller classes,
 * WITHOUT binding a network listener. Returns a {@link DecoratorHandler} whose
 * call returns `null` when no controller route matched — the caller decides the
 * miss (a standalone server answers 404; a host middleware falls through to its
 * own routing). This is the reusable dispatch seam consumed by the framework's
 * controller dispatch (#122) so it never re-implements match/bind/validate.
 */
export function createDecoratorHandler(
  controllersOrOpts: Function[] | CreateDecoratorServerOptions,
): DecoratorHandler {
  const { controllers, container, configure, serveAgent } = Array.isArray(controllersOrOpts)
    ? {
        controllers: controllersOrOpts,
        container: undefined,
        configure: undefined,
        serveAgent: undefined,
      }
    : controllersOrOpts

  // Collect middleware
  const middlewareConsumer = new MiddlewareConsumerImpl(container)
  if (configure) configure(middlewareConsumer)
  const middlewareEntries = middlewareConsumer.getEntries()

  // Dedupe controllers (EC-5)
  const seen = new Set<Function>()
  const unique: Function[] = []
  for (const Ctor of controllers) {
    if (seen.has(Ctor)) continue
    seen.add(Ctor)
    unique.push(Ctor)
  }

  // Walk metadata.
  //
  // A constructor that throws is CONTAINED to its own controller (#577). This loop used to
  // propagate, so one class failing to build discarded the handler for all of them — and since the
  // framework builds this lazily inside request dispatch, the throw escaped as an unhandled
  // rejection and exited the process. Reported from a real app: one optional plugin's env var was
  // unset, the app booted, logged the plugin as skipped, and died on the first request to ANY
  // route. The operator had been told it degraded gracefully.
  //
  // The routes are still registered, with the error in place of the instance, so the failure is
  // visible where it belongs — a 500 on that controller's paths — instead of everywhere.
  const routes: RouteEntry[] = []
  for (const Ctor of unique) {
    let built: { instance: object } | { failure: ControllerConstructionFailure }
    try {
      built = { instance: resolveOrNew(Ctor, container) }
    } catch (error) {
      built = { failure: { controllerName: Ctor.name, error } }
      // Once, here, and not per request: containment is not swallowing. A 500 nobody reads is the
      // silent failure this codebase refuses elsewhere, and the operator is already watching stdout.
      console.error(
        `[theokit] controller ${Ctor.name} failed to construct — its routes will answer 500:`,
        error instanceof Error ? error.message : String(error),
      )
    }
    for (const walk of walkControllerMetadata(Ctor)) {
      routes.push({ walk, ...built })
    }
  }

  // Sort: static routes first
  routes.sort((a, b) => {
    const aP = a.walk.fullPath.includes(':')
    const bP = b.walk.fullPath.includes(':')
    if (aP !== bP) return aP ? 1 : -1
    return 0
  })

  const handler = ((request: Request) =>
    handleRequest(routes, request, container, middlewareEntries, serveAgent)) as DecoratorHandler
  handler.matches = (method: string, pathname: string): boolean =>
    findRoute(routes, method.toUpperCase(), pathname) !== null
  return handler
}

/**
 * Creates a real HTTP server from decorated controller classes.
 * Uses Web Standard Request/Response internally; Node adapter at the boundary.
 */
export function createDecoratorServer(
  controllersOrOpts: Function[] | CreateDecoratorServerOptions,
) {
  const handle = createDecoratorHandler(controllersOrOpts)
  // Standalone server: a no-match (handler returns null) becomes a 404.
  const adapter = createNodeAdapter()
  return adapter.createServer(async (request: Request) => {
    const res = await handle(request)
    if (res) return res
    const { pathname } = new URL(request.url)
    return jsonResponse(404, {
      error: {
        code: 'NOT_FOUND',
        message: `No route for ${request.method.toUpperCase()} ${pathname}`,
      },
    })
  })
}

// ─── Web Standard request handler ────────────────────────────

async function handleRequest(
  routes: RouteEntry[],
  request: Request,
  container?: DiContainer,
  middlewareEntries: ResolvedMiddleware[] = [],
  serveAgent?: ServeAgent,
): Promise<Response | null> {
  const url = new URL(request.url)
  const method = request.method.toUpperCase()
  const pathname = url.pathname

  const match = findRoute(routes, method, pathname)
  // null = no controller route matched; the caller owns the miss (404 or fall-through).
  if (!match) return null

  const { walk, params } = match

  // Before anything reads `instance`. The route exists and is matched — what does not exist is the
  // controller behind it, and that is a 500 for these paths and nothing else (#577).
  if ('failure' in match) {
    const { controllerName, error } = match.failure
    const digested = digestError(error, {
      route: `${method} ${pathname}`,
      phase: 'construction',
      source: controllerName,
    })
    return jsonResponse(500, {
      error: {
        code: 'CONTROLLER_CONSTRUCTION_FAILED',
        // The cause, named, with the controller that failed: an operator has to be able to act on
        // this without attaching a debugger. `digestError` is what keeps the stack out of a
        // production response — the same redaction every other error path here gets.
        message: `Controller ${controllerName} failed to construct: ${digested.message}`,
        digest: digested.digest,
        ...(digested.stack === undefined ? {} : { stack: digested.stack }),
      },
    })
  }

  const { instance } = match

  try {
    // Middleware
    const mwResponse = await runMiddleware(middlewareEntries, request, pathname)
    if (mwResponse) return mwResponse

    // Guards
    const ctx = createExecutionContext(request, instance.constructor, walk.propertyKey)
    const guardResponse = await runGuards(walk.guards, ctx, container)
    if (guardResponse) return guardResponse

    // M47 — an @Expose-bound route is served by the injected agent runtime (mountAgent, via theo), AFTER
    // guards (auth applies to agents — G5) and NEVER as a JSON controller method. http stays agnostic.
    if (walk.agent) {
      if (!serveAgent) {
        return jsonResponse(500, {
          error: {
            code: 'AGENT_SERVER_NOT_WIRED',
            message:
              `Controller route ${String(walk.propertyKey)} is @Expose-bound but no serveAgent was ` +
              `provided to createDecoratorHandler. The framework must wire serveAgent (mountAgent).`,
          },
        })
      }
      return await serveAgent(walk.agent.module, request, walk.agent.opts)
    }

    // Body
    const body = await resolveBody(method, request, walk, jsonResponse)
    if (body instanceof Response) return body // validation error response

    // Build args
    const args = buildArgs(walk.paramEntries, {
      request,
      body,
      params,
      query: Object.fromEntries(url.searchParams),
    })

    // Redirect
    if (walk.redirect) {
      return new Response(null, {
        status: walk.redirect.status,
        headers: { location: walk.redirect.url },
      })
    }

    const handlerFn = (instance as Record<string | symbol, Function>)[walk.propertyKey]

    // Interceptors wrap handler
    const result = await runInterceptors(
      walk.interceptors,
      () => handlerFn.apply(instance, args) as Promise<unknown>,
      request,
      container,
    )

    // A handler may return a Web `Response` directly (Set-Cookie, custom status /
    // headers) — parity with file-based `route()`. Pass it through untouched
    // instead of JSON-stringifying it into `{}`.
    if (result instanceof Response) return result

    return buildResponse(result, walk, method)
  } catch (err) {
    return runExceptionFilters(err, walk.filters, request, container)
  }
}

// ─── Guards (return Response on rejection, null on pass) ─────

async function runGuards(
  guards: Function[],
  context: ExecutionContext,
  container?: DiContainer,
): Promise<Response | null> {
  for (const GuardCtor of guards) {
    const guard = resolveOrNew(GuardCtor, container) as CanActivate
    const allowed = await guard.canActivate(context)
    if (!allowed) {
      const ex = new ForbiddenException('Forbidden resource')
      return jsonResponse(ex.statusCode, ex.toJSON())
    }
  }
  return null
}

// ─── Body resolution ─────────────────────────────────────────

// ─── Response builder ────────────────────────────────────────

function buildResponse(result: unknown, walk: WalkResult, method: string): Response {
  const status = walk.status ?? (method === 'POST' ? 201 : 200)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  for (const [name, value] of walk.headers) {
    headers[name.toLowerCase()] = value
  }

  if (result === undefined || result === null) {
    return new Response(null, { status: status === 200 ? 204 : status, headers })
  }

  if (typeof result === 'string') {
    headers['content-type'] = 'text/plain'
    return new Response(result, { status, headers })
  }

  return new Response(JSON.stringify(result), { status, headers })
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// ─── Route matching ──────────────────────────────────────────

/** A {@link RouteEntry} plus the path parameters that matched it. */
type RouteMatch = RouteEntry & { params: Record<string, string> }

function findRoute(routes: RouteEntry[], method: string, pathname: string): RouteMatch | null {
  for (const entry of routes) {
    if (entry.walk.verb !== 'ALL' && entry.walk.verb !== method) continue
    const params = matchPath(entry.walk.fullPath, pathname)
    // Spread the whole entry: picking fields off it is how `constructionError` would silently stop
    // reaching the dispatcher the next time one is added.
    if (params !== null) return { ...entry, params }
  }
  return null
}

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const paramNames: string[] = []
  const regexStr = pattern.replace(/:(\w+)/g, (_m, name: string) => {
    paramNames.push(name)
    return '([^/]+)'
  })
  const match = new RegExp(`^${regexStr}$`).exec(pathname)
  if (!match) return null
  const params: Record<string, string> = {}
  paramNames.forEach((name, i) => {
    params[name] = match[i + 1]
  })
  return params
}

// ─── Argument builder ────────────────────────────────────────

interface ArgContext {
  request: Request
  body: unknown
  params: Record<string, string>
  query: Record<string, string>
}

function buildArgs(paramEntries: ParamEntry[], ctx: ArgContext): unknown[] {
  if (paramEntries.length === 0) return []
  const maxIndex = Math.max(...paramEntries.map((p) => p.index))
  const args: unknown[] = Array.from({ length: maxIndex + 1 }, () => undefined)
  for (const p of paramEntries) {
    switch (p.source) {
      case 'req':
        args[p.index] = ctx.request
        break
      case 'body':
        args[p.index] = p.key ? (ctx.body as Record<string, unknown>)[p.key] : ctx.body
        break
      case 'param':
        args[p.index] = p.key ? ctx.params[p.key] : ctx.params
        break
      case 'query':
        args[p.index] = p.key ? ctx.query[p.key] : ctx.query
        break
      case 'headers':
        args[p.index] = p.key
          ? ctx.request.headers.get(p.key.toLowerCase())
          : Object.fromEntries(ctx.request.headers.entries())
        break
      case 'ip':
        args[p.index] = ctx.request.headers.get('x-forwarded-for') ?? '127.0.0.1'
        break
      case 'session':
        args[p.index] = undefined
        break
      default:
        args[p.index] = undefined
    }
  }
  return args
}
