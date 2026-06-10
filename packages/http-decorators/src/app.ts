/* eslint-disable security/detect-non-literal-regexp */
import 'reflect-metadata'

import { createExecutionContext, type CanActivate } from './bridge/execution-context.js'
import { createNodeAdapter } from './bridge/runtime/node.js'
import type { ServerHandle } from './bridge/runtime/types.js'
import { walkControllerMetadata, type WalkResult } from './bridge/walk-metadata.js'
import type { ParamEntry } from './decorators/params.js'
import { ForbiddenException } from './exceptions/http-exception.js'

/**
 * TheoApp — NestJS/Spring Boot-style application bootstrap.
 *
 * Internally uses Web Standard Request/Response pipeline.
 * Node adapter converts at the HTTP server boundary.
 */

export interface TheoAppOptions {
  controllers: Function[]
  agents?: Function[]
  module?: Function
  providers?: Function[]
  agentPlugin?: {
    register: (app: { addHook: (name: string, fn: Function) => void }) => void
  }
}

interface RouteEntry {
  walk: WalkResult
  instance: object
}

export class TheoApp {
  private serverHandle: ServerHandle
  private readonly routes: RouteEntry[] = []
  private agentHooks: Function[] = []

  private constructor() {
    const adapter = createNodeAdapter()
    this.serverHandle = adapter.createServer((request) => this.handleRequest(request))
  }

  static create(opts: TheoAppOptions): TheoApp {
    const app = new TheoApp()

    // DI registry
    const registry = new Map<Function, object>()

    // Module resolution
    if (opts.module) {
      const moduleMeta = Reflect.getMetadata('usetheo:di:module', opts.module)
      if (moduleMeta) {
        const allModules = [opts.module, ...(moduleMeta.imports ?? [])]
        for (const Module of allModules) {
          const meta = Reflect.getMetadata('usetheo:di:module', Module)
          if (!meta) continue
          for (const Provider of (meta.providers ?? [])) {
            if (!registry.has(Provider)) {
              registry.set(Provider, new (Provider as new () => object)())
            }
          }
        }
      }
    }

    // Inline providers
    if (opts.providers) {
      for (const Provider of opts.providers) {
        if (!registry.has(Provider)) {
          registry.set(Provider, new (Provider as new () => object)())
        }
      }
    }

    // Controllers with DI
    for (const Controller of opts.controllers) {
      const paramTypes: Function[] = Reflect.getMetadata('design:paramtypes', Controller) ?? []
      const args = paramTypes.map((pt: Function) => {
        const dep = registry.get(pt)
        if (!dep) {
          throw new Error(
            `[TheoApp] Cannot resolve ${pt.name} for ${Controller.name}. ` +
              `Add ${pt.name} to providers (or to @Module({ providers: [...] })).`,
          )
        }
        return dep
      })
      const instance = new (Controller as new (...a: unknown[]) => object)(...args)
      const walks = walkControllerMetadata(Controller)
      for (const w of walks) {
        app.routes.push({ walk: w, instance })
      }
    }

    // Sort: static before parameterized
    app.routes.sort((a, b) => {
      const aP = a.walk.fullPath.includes(':')
      const bP = b.walk.fullPath.includes(':')
      if (aP !== bP) return aP ? 1 : -1
      return 0
    })

    // Agent plugin
    if (opts.agents?.length && opts.agentPlugin) {
      const hooks: Function[] = []
      opts.agentPlugin.register({
        addHook(_name: string, fn: Function) { hooks.push(fn) },
      })
      app.agentHooks = hooks
    }

    return app
  }

  async listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.serverHandle.listen(port, () => {
        console.log(`TheoKit app listening on http://localhost:${port}`)
        resolve()
      })
    })
  }

  getServerHandle(): ServerHandle {
    return this.serverHandle
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.serverHandle.close(() => { resolve(); })
    })
  }

  // ── Web Standard request handler ──────────────────

  private async handleRequest(request: Request): Promise<Response> {
    // Agent hooks
    for (const hook of this.agentHooks) {
      const result = await (hook as (ctx: { request: Request }) => Promise<Response | undefined>)({ request })
      if (result instanceof Response) return result
    }

    const url = new URL(request.url)
    const method = request.method.toUpperCase()

    const match = this.findRoute(method, url.pathname)
    if (!match) {
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `No route for ${method} ${url.pathname}` } })
    }

    const { entry, params } = match

    try {
      // Guards
      const ctx = createExecutionContext(request, entry.instance.constructor, entry.walk.propertyKey)
      for (const GuardCtor of entry.walk.guards) {
        const guard = new (GuardCtor as new () => CanActivate)()
        if (!(await guard.canActivate(ctx))) {
          const ex = new ForbiddenException('Forbidden resource')
          return jsonResponse(ex.statusCode, ex.toJSON())
        }
      }

      // Body
      let body: unknown
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        try {
          const text = await request.text()
          body = text ? JSON.parse(text) : undefined
        } catch { body = undefined }

        if (entry.walk.bodySchema && body !== undefined) {
          const result = entry.walk.bodySchema.safeParse(body)
          if (!result.success) {
            return jsonResponse(422, { error: { code: 'VALIDATION_ERROR', issues: result.error.issues } })
          }
          body = result.data
        }
      }

      // Args
      const args = this.buildArgs(entry.walk.paramEntries, request, body, params, Object.fromEntries(url.searchParams))

      // Redirect
      if (entry.walk.redirect) {
        return new Response(null, { status: entry.walk.redirect.status, headers: { location: entry.walk.redirect.url } })
      }

      // Handler
      const handler = (entry.instance as Record<string | symbol, Function>)[entry.walk.propertyKey]
      const result = await handler.apply(entry.instance, args)

      return buildResponse(result, entry.walk, method)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return jsonResponse(500, { error: { code: 'INTERNAL_SERVER_ERROR', message } })
    }
  }

  private findRoute(method: string, pathname: string) {
    for (const entry of this.routes) {
      if (entry.walk.verb !== 'ALL' && entry.walk.verb !== method) continue
      const paramNames: string[] = []
      const regexStr = entry.walk.fullPath.replace(/:(\w+)/g, (_m, name: string) => {
        paramNames.push(name)
        return '([^/]+)'
      })
      const match = new RegExp(`^${regexStr}$`).exec(pathname)
      if (!match) continue
      const params: Record<string, string> = {}
      paramNames.forEach((name, i) => { params[name] = match[i + 1] })
      return { entry, params }
    }
    return null
  }

  private buildArgs(entries: ParamEntry[], request: Request, body: unknown, params: Record<string, string>, query: Record<string, string>): unknown[] {
    if (entries.length === 0) return []
    const max = Math.max(...entries.map(p => p.index))
    const args: unknown[] = Array.from({ length: max + 1 }, () => undefined)
    for (const p of entries) {
      switch (p.source) {
        case 'req': args[p.index] = request; break
        case 'body': args[p.index] = p.key ? (body as Record<string, unknown>)[p.key] : body; break
        case 'param': args[p.index] = p.key ? params[p.key] : params; break
        case 'query': args[p.index] = p.key ? query[p.key] : query; break
        case 'headers': args[p.index] = p.key ? request.headers.get(p.key.toLowerCase()) : Object.fromEntries(request.headers.entries()); break
        case 'ip': args[p.index] = request.headers.get('x-forwarded-for') ?? '127.0.0.1'; break
        default: args[p.index] = undefined
      }
    }
    return args
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function buildResponse(result: unknown, walk: WalkResult, method: string): Response {
  const status = walk.status ?? (method === 'POST' ? 201 : 200)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  for (const [n, v] of walk.headers) headers[n.toLowerCase()] = v

  if (result === undefined || result === null) {
    return new Response(null, { status: status === 200 ? 204 : status, headers })
  }
  if (typeof result === 'string') {
    headers['content-type'] = 'text/plain'
    return new Response(result, { status, headers })
  }
  return new Response(JSON.stringify(result), { status, headers })
}
