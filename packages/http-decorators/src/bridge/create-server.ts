/* eslint-disable security/detect-non-literal-regexp --
 * Route patterns like /cats/:id are converted to regex at startup —
 * NOT from user HTTP input. The patterns come from decorator metadata
 * authored by the developer. No injection vector.
 */
import 'reflect-metadata'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import type { ParamEntry } from '../decorators/params.js'

import { walkControllerMetadata, type WalkResult } from './walk-metadata.js'

/**
 * Creates a real HTTP server from decorated controller classes.
 * This is the mount mechanism that makes `@Controller`/`@Get`/`@Body` decorators
 * produce real HTTP endpoints reachable via `fetch()`.
 *
 * Usage:
 * ```ts
 * const server = createDecoratorServer([CatsController, DogsController])
 * server.listen(3000)
 * // fetch('http://localhost:3000/cats') → CatsController.findAll()
 * ```
 */
/** DI container interface — structural match for @theokit/di Container. */
export interface DiContainer {
  resolve<T>(token: Function): T
}

export interface CreateDecoratorServerOptions {
  controllers: Function[]
  /** Optional DI container (e.g., @theokit/di Container). When provided,
   *  controllers + guards are resolved via container.resolve() instead of bare `new`.
   *  Enables NestJS-style constructor injection: `constructor(private svc: MyService)`. */
  container?: DiContainer
}

export function createDecoratorServer(
  controllersOrOpts: Function[] | CreateDecoratorServerOptions,
) {
  const { controllers, container } = Array.isArray(controllersOrOpts)
    ? { controllers: controllersOrOpts, container: undefined }
    : { controllers: controllersOrOpts.controllers, container: controllersOrOpts.container }
  // Dedupe controllers (EC-5)
  const seen = new Set<Function>()
  const unique: Function[] = []
  for (const Ctor of controllers) {
    if (seen.has(Ctor)) continue
    seen.add(Ctor)
    unique.push(Ctor)
  }

  // Walk metadata for all controllers
  const routes: { walk: WalkResult; instance: object }[] = []
  for (const Ctor of unique) {
    const instance = resolveOrNew(Ctor, container)
    const walks = walkControllerMetadata(Ctor)
    for (const w of walks) {
      routes.push({ walk: w, instance })
    }
  }

  // Sort: static routes first, parameterized last (prevents /cats/:id matching "admin")
  routes.sort((a, b) => {
    const aHasParam = a.walk.fullPath.includes(':')
    const bHasParam = b.walk.fullPath.includes(':')
    if (aHasParam !== bHasParam) return aHasParam ? 1 : -1
    return 0
  })

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(routes, req, res, container)
  })

  return server
}

// ─── Request handler (extracted for complexity budget) ─────────

async function handleRequest(
  routes: { walk: WalkResult; instance: object }[],
  req: IncomingMessage,
  res: ServerResponse,
  container?: DiContainer,
) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const method = (req.method ?? 'GET').toUpperCase()
  const pathname = url.pathname

  const match = findRoute(routes, method, pathname)
  if (!match) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        error: { code: 'NOT_FOUND', message: `No route for ${method} ${pathname}` },
      }),
    )
    return
  }

  const { walk, instance, params } = match

  try {
    if (await runGuards(walk.guards, req, res, container)) return

    const body = await resolveBody(method, req, walk, res)
    if (body === BODY_REJECTED) return

    const args = buildArgs(walk.paramEntries, {
      req,
      body,
      params,
      query: Object.fromEntries(url.searchParams),
    })

    if (walk.redirect) {
      res.writeHead(walk.redirect.status, { location: walk.redirect.url })
      res.end()
      return
    }

    const handler = (instance as Record<string | symbol, Function>)[walk.propertyKey]
    const result = await handler.apply(instance, args)

    sendResponse(res, result, walk, method)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { code: 'INTERNAL_SERVER_ERROR', message } }))
  }
}

// ─── Guards ───────────────────────────────────────────────────

/** Returns true if guard rejected (response already sent). */
async function runGuards(
  guards: Function[],
  req: IncomingMessage,
  res: ServerResponse,
  container?: DiContainer,
): Promise<boolean> {
  for (const GuardCtor of guards) {
    const guard = resolveOrNew(GuardCtor, container) as {
      canActivate: (req: IncomingMessage) => boolean | Promise<boolean>
    }
    const allowed = await guard.canActivate(req)
    if (!allowed) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Guard rejected' } }))
      return true
    }
  }
  return false
}

// ─── Body resolution ──────────────────────────────────────────

const BODY_REJECTED = Symbol('body-rejected')

/** Parses + validates body. Returns BODY_REJECTED if response was sent. */
async function resolveBody(
  method: string,
  req: IncomingMessage,
  walk: WalkResult,
  res: ServerResponse,
): Promise<unknown> {
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return undefined

  let body = await parseBody(req)
  if (walk.bodySchema && body !== undefined) {
    const result = walk.bodySchema.safeParse(body)
    if (!result.success) {
      res.writeHead(422, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'VALIDATION_ERROR', issues: result.error.issues } }))
      return BODY_REJECTED
    }
    body = result.data
  }
  return body
}

// ─── Response serialization ───────────────────────────────────

function sendResponse(res: ServerResponse, result: unknown, walk: WalkResult, method: string) {
  const status = walk.status ?? (method === 'POST' ? 201 : 200)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  for (const [name, value] of walk.headers) {
    headers[name.toLowerCase()] = value
  }

  if (result === undefined || result === null) {
    res.writeHead(status === 200 ? 204 : status, headers)
    res.end()
    return
  }

  if (typeof result === 'string') {
    headers['content-type'] = 'text/plain'
    res.writeHead(status, headers)
    res.end(result)
    return
  }

  res.writeHead(status, headers)
  res.end(JSON.stringify(result))
}

// ─── Route matching ───────────────────────────────────────────

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
    if (params !== null) {
      return { walk, instance, params }
    }
  }
  return null
}

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const paramNames: string[] = []
  const regexStr = pattern.replace(/:(\w+)/g, (_m, name: string) => {
    paramNames.push(name)
    return '([^/]+)'
  })
  const regex = new RegExp(`^${regexStr}$`)
  const match = pathname.match(regex)
  if (!match) return null
  const params: Record<string, string> = {}
  paramNames.forEach((name, i) => {
    params[name] = match[i + 1]
  })
  return params
}

// ─── Body parsing ─────────────────────────────────────────────

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve(raw)
      }
    })
    req.on('error', reject)
  })
}

// ─── Argument builder ─────────────────────────────────────────

interface ArgContext {
  req: IncomingMessage
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
        args[p.index] = ctx.req
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
        args[p.index] = p.key ? ctx.req.headers[p.key.toLowerCase()] : ctx.req.headers
        break
      case 'ip':
        args[p.index] = ctx.req.socket.remoteAddress
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

// ─── DI resolution helper ─────────────────────────────

/** Resolve via DI container if provided; otherwise fall back to bare `new`. */
function resolveOrNew(Ctor: Function, container?: DiContainer): object {
  if (container) {
    try {
      return container.resolve(Ctor)
    } catch {
      // MissingInjectableError or similar — fall back to bare new
    }
  }
  return new (Ctor as new () => object)()
}
