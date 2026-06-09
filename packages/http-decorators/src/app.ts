import 'reflect-metadata'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { walkControllerMetadata, type WalkResult } from './bridge/walk-metadata.js'
import type { ParamEntry } from './decorators/params.js'

/**
 * TheoApp — NestJS/Spring Boot-style application bootstrap.
 *
 * Uses `@theokit/di`'s `@Module({ providers, imports, exports })` for DI
 * and adds a `controllers` field for HTTP endpoint registration.
 *
 * ```ts
 * import { Module } from '@theokit/di'     // <-- from @theokit/di (already shipped)
 * import { TheoApp } from '@theokit/http-decorators'
 *
 * @Module({
 *   providers: [TaskService],
 *   imports: [SharedModule],
 *   exports: [TaskService],
 * })
 * class AppModule {}
 *
 * const app = TheoApp.create({
 *   module: AppModule,
 *   controllers: [TasksController, HealthController],
 * })
 * await app.listen(3000)
 * ```
 *
 * Alternatively, for quick prototyping without @theokit/di:
 *
 * ```ts
 * const app = TheoApp.create({
 *   controllers: [TasksController],
 *   providers: [TaskService],
 * })
 * ```
 */

export interface TheoAppOptions {
  /** Controllers to mount (classes decorated with @Controller). */
  controllers: Function[]
  /** Optional: @theokit/di @Module class. When provided, its providers/imports/exports
   *  are used for DI resolution. When absent, providers array below is used. */
  module?: Function
  /** Inline providers (shorthand when not using @Module). Each is instantiated as singleton. */
  providers?: Function[]
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
   * Create a TheoKit application.
   *
   * NestJS:  `const app = await NestFactory.create(AppModule)`
   * Spring:  `SpringApplication.run(AppClass.class)`
   * TheoKit: `const app = TheoApp.create({ module: AppModule, controllers: [...] })`
   *
   * Or simpler (without @Module):
   *   `const app = TheoApp.create({ controllers: [...], providers: [...] })`
   */
  static create(opts: TheoAppOptions): TheoApp {
    const app = new TheoApp()

    // Build provider registry
    const registry = new Map<Function, object>()

    // Strategy 1: @Module from @theokit/di (reads usetheo:di:module metadata)
    if (opts.module) {
      const moduleMeta = Reflect.getMetadata('usetheo:di:module', opts.module) as
        | { providers?: Array<Function | { provide: unknown }>; imports?: Function[]; exports?: unknown[] }
        | undefined

      if (moduleMeta?.imports) {
        for (const ImportedModule of moduleMeta.imports) {
          const importMeta = Reflect.getMetadata('usetheo:di:module', ImportedModule) as
            | { providers?: Array<Function | { provide: unknown }>; exports?: unknown[] }
            | undefined
          if (importMeta?.providers) {
            for (const p of importMeta.providers) {
              if (typeof p === 'function' && !registry.has(p)) {
                registry.set(p, new (p as new () => object)())
              }
            }
          }
        }
      }

      if (moduleMeta?.providers) {
        for (const p of moduleMeta.providers) {
          if (typeof p === 'function' && !registry.has(p)) {
            registry.set(p, new (p as new () => object)())
          }
        }
      }
    }

    // Strategy 2: inline providers (shorthand)
    if (opts.providers) {
      for (const Provider of opts.providers) {
        if (!registry.has(Provider)) {
          registry.set(Provider, new (Provider as new () => object)())
        }
      }
    }

    // Resolve controllers with DI
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

    // Sort: static routes before parameterized
    app.routes.sort((a, b) => {
      const aP = a.walk.fullPath.includes(':')
      const bP = b.walk.fullPath.includes(':')
      if (aP !== bP) return aP ? 1 : -1
      return 0
    })

    return app
  }

  /** Start listening. */
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
      this.server.close(() => resolve())
    })
  }

  // ── Request handler ──────────────────────────────
  /* eslint-disable security/detect-non-literal-regexp */

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const method = (req.method ?? 'GET').toUpperCase()

    const match = this.findRoute(method, url.pathname)
    if (!match) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: `No route for ${method} ${url.pathname}` } }))
      return
    }

    const { entry, params } = match

    try {
      // Guards
      for (const GuardCtor of entry.walk.guards) {
        const guard = new (GuardCtor as new () => { canActivate: (r: IncomingMessage) => boolean | Promise<boolean> })()
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
        if (entry.walk.bodySchema && body !== undefined) {
          const result = entry.walk.bodySchema.safeParse(body)
          if (!result.success) {
            res.writeHead(422, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: { code: 'VALIDATION_ERROR', issues: result.error.issues } }))
            return
          }
          body = result.data
        }
      }

      // Args
      const args = this.buildArgs(entry.walk.paramEntries, req, body, params, Object.fromEntries(url.searchParams))

      // Redirect
      if (entry.walk.redirect) {
        res.writeHead(entry.walk.redirect.status, { location: entry.walk.redirect.url })
        res.end()
        return
      }

      // Handler
      const handler = (entry.instance as Record<string | symbol, Function>)[entry.walk.propertyKey]
      const result = await handler.apply(entry.instance, args)

      // Response
      this.sendResponse(res, result, entry.walk, method)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'INTERNAL_SERVER_ERROR', message } }))
    }
  }

  private sendResponse(res: ServerResponse, result: unknown, walk: WalkResult, method: string) {
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
  }

  private findRoute(method: string, pathname: string) {
    for (const entry of this.routes) {
      if (entry.walk.verb !== 'ALL' && entry.walk.verb !== method) continue
      const paramNames: string[] = []
      const regexStr = entry.walk.fullPath.replace(/:(\w+)/g, (_m, name: string) => {
        paramNames.push(name)
        return '([^/]+)'
      })
      const match = pathname.match(new RegExp(`^${regexStr}$`))
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
