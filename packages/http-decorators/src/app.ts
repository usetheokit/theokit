import 'reflect-metadata'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { walkControllerMetadata, type WalkResult } from './bridge/walk-metadata.js'
import type { ParamEntry } from './decorators/params.js'

/**
 * TheoApp — NestJS/Spring Boot-style application bootstrap.
 *
 * Replaces the manual Container + createDecoratorServer boilerplate.
 * The consumer writes:
 *
 * ```ts
 * @Module({
 *   controllers: [TasksController, HealthController],
 *   providers: [TaskService],
 * })
 * class AppModule {}
 *
 * const app = await TheoApp.create(AppModule)
 * await app.listen(3000)
 * ```
 *
 * That's it. No manual Container, no createDecoratorServer, no wiring.
 */

export interface ModuleMetadata {
  controllers?: Function[]
  providers?: Function[]
  imports?: Function[]
}

const MODULE_METADATA = Symbol('theokit:module')

/**
 * @Module decorator — declares controllers + providers for a module.
 * Mirrors NestJS's @Module({ controllers, providers }).
 */
export function Module(metadata: ModuleMetadata): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(MODULE_METADATA, metadata, target)
  }
}

interface RouteEntry {
  walk: WalkResult
  instance: object
}

export class TheoApp {
  private server: Server
  private readonly routes: RouteEntry[] = []

  private constructor() {
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res)
    })
  }

  /**
   * Create a TheoKit application from a module class.
   *
   * Equivalent to NestJS's `NestFactory.create(AppModule)`.
   *
   * ```ts
   * const app = await TheoApp.create(AppModule)
   * await app.listen(3000)
   * ```
   */
  static create(moduleClass: Function): TheoApp {
    const app = new TheoApp()

    const metadata = Reflect.getMetadata(MODULE_METADATA, moduleClass) as ModuleMetadata | undefined
    if (!metadata) {
      throw new Error(
        `${moduleClass.name} is not a module — add @Module({ controllers, providers }) decorator`,
      )
    }

    // Build DI registry from providers
    const registry = new Map<Function, object>()

    // Register providers (instantiate singletons)
    for (const Provider of metadata.providers ?? []) {
      registry.set(Provider, new (Provider as new () => object)())
    }

    // Process imported modules recursively
    for (const ImportedModule of metadata.imports ?? []) {
      const importMeta = Reflect.getMetadata(MODULE_METADATA, ImportedModule) as ModuleMetadata | undefined
      if (importMeta?.providers) {
        for (const Provider of importMeta.providers) {
          if (!registry.has(Provider)) {
            registry.set(Provider, new (Provider as new () => object)())
          }
        }
      }
    }

    // Resolve controllers with DI
    for (const Controller of metadata.controllers ?? []) {
      const paramTypes: Function[] = Reflect.getMetadata('design:paramtypes', Controller) ?? []
      const args = paramTypes.map((pt: Function) => {
        const dep = registry.get(pt)
        if (!dep) {
          throw new Error(
            `[TheoApp] Cannot resolve ${pt.name} for ${Controller.name}. ` +
            `Add ${pt.name} to the providers array in @Module().`,
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

    // Sort: static routes before parameterized
    app.routes.sort((a, b) => {
      const aP = a.walk.fullPath.includes(':')
      const bP = b.walk.fullPath.includes(':')
      if (aP !== bP) return aP ? 1 : -1
      return 0
    })

    return app
  }

  /**
   * Start listening on a port.
   *
   * ```ts
   * await app.listen(3000)
   * // TheoKit Decorator App listening on http://localhost:3000
   * ```
   */
  async listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(port, () => {
        console.log(`TheoKit app listening on http://localhost:${port}`)
        resolve()
      })
    })
  }

  /** Get the underlying HTTP server (for testing). */
  getHttpServer(): Server {
    return this.server
  }

  /** Close the server. */
  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => { resolve(); })
    })
  }

  // ── Request handler ──────────────────────────────

  /* eslint-disable security/detect-non-literal-regexp */
  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const method = (req.method ?? 'GET').toUpperCase()

    // Find matching route
    const match = this.findRoute(method, url.pathname)
    if (!match) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: `No route for ${method} ${url.pathname}` } }))
      return
    }

    const { entry, params } = match
    const { walk, instance } = entry

    try {
      // Guards
      for (const GuardCtor of walk.guards) {
        const guard = new (GuardCtor as new () => { canActivate: (r: typeof req) => boolean | Promise<boolean> })()
        if (!(await guard.canActivate(req))) {
          res.writeHead(401, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Guard rejected' } }))
          return
        }
      }

      // Body
      let body: unknown
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        body = await this.parseBody(req)
        if (walk.bodySchema && body !== undefined) {
          const result = walk.bodySchema.safeParse(body)
          if (!result.success) {
            res.writeHead(422, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: { code: 'VALIDATION_ERROR', issues: result.error.issues } }))
            return
          }
          body = result.data
        }
      }

      // Args
      const args = this.buildArgs(walk.paramEntries, req, body, params, Object.fromEntries(url.searchParams))

      // Redirect
      if (walk.redirect) {
        res.writeHead(walk.redirect.status, { location: walk.redirect.url })
        res.end()
        return
      }

      // Handler
      const handler = (instance as Record<string | symbol, Function>)[walk.propertyKey]
      const result = await handler.apply(instance, args)

      // Response
      const status = walk.status ?? (method === 'POST' ? 201 : 200)
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      for (const [n, v] of walk.headers) headers[n.toLowerCase()] = v

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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'INTERNAL_SERVER_ERROR', message } }))
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

  private parseBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        if (!raw) { resolve(undefined); return }
        try { resolve(JSON.parse(raw)) } catch { resolve(raw) }
      })
      req.on('error', reject)
    })
  }

  private buildArgs(entries: ParamEntry[], req: IncomingMessage, body: unknown, params: Record<string, string>, query: Record<string, string>): unknown[] {
    if (entries.length === 0) return []
    const max = Math.max(...entries.map(p => p.index))
    const args: unknown[] = Array.from({ length: max + 1 }, () => undefined)
    for (const p of entries) {
      switch (p.source) {
        case 'req': args[p.index] = req; break
        case 'body': args[p.index] = p.key ? (body as Record<string, unknown>)[p.key] : body; break
        case 'param': args[p.index] = p.key ? params[p.key] : params; break
        case 'query': args[p.index] = p.key ? query[p.key] : query; break
        case 'headers': args[p.index] = p.key ? req.headers[p.key.toLowerCase()] : req.headers; break
        case 'ip': args[p.index] = req.socket.remoteAddress; break
        default: args[p.index] = undefined
      }
    }
    return args
  }
}
