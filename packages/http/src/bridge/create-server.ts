/* eslint-disable security/detect-non-literal-regexp --
 * Route patterns like /cats/:id are converted to regex at startup —
 * NOT from user HTTP input. The patterns come from decorator metadata
 * authored by the developer. No injection vector.
 */
import 'reflect-metadata'

import type { ParamEntry } from '../decorators/params.js'
import { ForbiddenException } from '../exceptions/http-exception.js'

import { resolveOrNew, type DiContainer } from './di-resolve.js'
import { runExceptionFilters } from './exception-filter-chain.js'
import { createExecutionContext, type CanActivate, type ExecutionContext } from './execution-context.js'
import { runInterceptors } from './interceptor-chain.js'
import {
  MiddlewareConsumerImpl,
  runMiddleware,
  type ResolvedMiddleware,
} from './middleware-consumer.js'
import { createNodeAdapter } from './runtime/node.js'
import { walkControllerMetadata, type WalkResult } from './walk-metadata.js'

/**
 * Creates a real HTTP server from decorated controller classes.
 * Uses Web Standard Request/Response internally; Node adapter at the boundary.
 */
export interface CreateDecoratorServerOptions {
  controllers: Function[]
  container?: DiContainer
  configure?: (consumer: MiddlewareConsumerImpl) => void
}

export function createDecoratorServer(
  controllersOrOpts: Function[] | CreateDecoratorServerOptions,
) {
  const { controllers, container, configure } = Array.isArray(controllersOrOpts)
    ? { controllers: controllersOrOpts, container: undefined, configure: undefined }
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

  // Walk metadata
  const routes: { walk: WalkResult; instance: object }[] = []
  for (const Ctor of unique) {
    const instance = resolveOrNew(Ctor, container)
    const walks = walkControllerMetadata(Ctor)
    for (const w of walks) {
      routes.push({ walk: w, instance })
    }
  }

  // Sort: static routes first
  routes.sort((a, b) => {
    const aP = a.walk.fullPath.includes(':')
    const bP = b.walk.fullPath.includes(':')
    if (aP !== bP) return aP ? 1 : -1
    return 0
  })

  // Create Web Standard handler + Node adapter
  const adapter = createNodeAdapter()
  const handler = (request: Request) => handleRequest(routes, request, container, middlewareEntries)
  return adapter.createServer(handler)
}

// ─── Web Standard request handler ────────────────────────────

async function handleRequest(
  routes: { walk: WalkResult; instance: object }[],
  request: Request,
  container?: DiContainer,
  middlewareEntries: ResolvedMiddleware[] = [],
): Promise<Response> {
  const url = new URL(request.url)
  const method = request.method.toUpperCase()
  const pathname = url.pathname

  const match = findRoute(routes, method, pathname)
  if (!match) {
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `No route for ${method} ${pathname}` } })
  }

  const { walk, instance, params } = match

  try {
    // Middleware
    const mwResponse = await runMiddleware(middlewareEntries, request, pathname)
    if (mwResponse) return mwResponse

    // Guards
    const ctx = createExecutionContext(request, instance.constructor, walk.propertyKey)
    const guardResponse = await runGuards(walk.guards, ctx, container)
    if (guardResponse) return guardResponse

    // Body
    const body = await resolveBody(method, request, walk)
    if (body instanceof Response) return body // validation error response

    // Build args
    const args = buildArgs(walk.paramEntries, { request, body, params, query: Object.fromEntries(url.searchParams) })

    // Redirect
    if (walk.redirect) {
      return new Response(null, { status: walk.redirect.status, headers: { location: walk.redirect.url } })
    }

    const handlerFn = (instance as Record<string | symbol, Function>)[walk.propertyKey]

    // Interceptors wrap handler
    const result = await runInterceptors(
      walk.interceptors,
      () => handlerFn.apply(instance, args) as Promise<unknown>,
      request,
      container,
    )

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

async function resolveBody(method: string, request: Request, walk: WalkResult): Promise<unknown> {
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return undefined

  let body: unknown
  try {
    const text = await request.text()
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = undefined
  }

  if (walk.bodySchema && body !== undefined) {
    const result = walk.bodySchema.safeParse(body)
    if (!result.success) {
      return jsonResponse(422, { error: { code: 'VALIDATION_ERROR', issues: result.error.issues } })
    }
    body = result.data
  }
  return body
}

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

interface RouteMatch {
  walk: WalkResult
  instance: object
  params: Record<string, string>
}

function findRoute(
  routes: { walk: WalkResult; instance: object }[],
  method: string,
  pathname: string,
): RouteMatch | null {
  for (const { walk, instance } of routes) {
    if (walk.verb !== 'ALL' && walk.verb !== method) continue
    const params = matchPath(walk.fullPath, pathname)
    if (params !== null) return { walk, instance, params }
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
  paramNames.forEach((name, i) => { params[name] = match[i + 1] })
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
        args[p.index] = p.key ? ctx.request.headers.get(p.key.toLowerCase()) : Object.fromEntries(ctx.request.headers.entries())
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
