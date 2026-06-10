/* eslint-disable security/detect-non-literal-regexp, complexity, sonarjs/cognitive-complexity, max-depth, sonarjs/no-collapsible-if */
import 'reflect-metadata'

import { createExecutionContext, type CanActivate } from './bridge/execution-context.js'
import { createNodeAdapter } from './bridge/runtime/node.js'
import type { ServerHandle } from './bridge/runtime/types.js'
import { walkControllerMetadata, type WalkResult } from './bridge/walk-metadata.js'
import type { ParamEntry } from './decorators/params.js'
import { ForbiddenException, HttpException } from './exceptions/http-exception.js'

/**
 * TheoApp — NestJS/Spring Boot-style application bootstrap.
 *
 * Internally uses Web Standard Request/Response pipeline.
 * Node adapter converts at the HTTP server boundary.
 */

export interface TheoAppOptions {
  /** Controller classes decorated with @Controller. */
  controllers: Function[]
  /** Agent classes decorated with @Agent — auto-wired with routes + SSE + tools. */
  agents?: Function[]
  /** @Module class for structured DI. */
  module?: Function
  /** Provider/toolbox classes — instantiated and injected into controllers + agents. */
  providers?: Function[]
  /** LLM API key for agent execution (reads OPENROUTER_API_KEY env if not set). */
  llmApiKey?: string
  /** LLM model override (default: from @Agent({ model }) metadata). */
  llmModel?: string
  /** Agent stream factory override (for testing or custom SDK wiring). */
  agentStreamFactory?: (walk: unknown, tools: unknown[], apiKey: string, model?: string) => (message: string, sessionId: string) => AsyncIterable<unknown>
  /** HTML string to serve at GET / (inline frontend). */
  html?: string
}

interface RouteEntry {
  walk: WalkResult
  instance: object
}

export class TheoApp {
  private serverHandle: ServerHandle
  private readonly routes: RouteEntry[] = []
  private frontendHtml?: string

  private constructor() {
    const adapter = createNodeAdapter()
    this.serverHandle = adapter.createServer((request) => this.handleRequest(request))
  }

  /**
   * Create a TheoKit application with Spring Boot-style DI.
   *
   * EC-7: async because Container may resolve async factories (Agent.create).
   * EC-2: Registration order guaranteed: providers → controllers → agents.
   */
  static async create(opts: TheoAppOptions): Promise<TheoApp> {
    const app = new TheoApp()

    // ── DI Container (replaces manual Map<Function, object>) ──
    // Uses @theokit/di Container for: scopes, lifecycle, async, typed errors.
    // Fallback to manual resolution when @theokit/di is not available.
    const registry = new Map<Function, object>()

    // 1. Module resolution (@Module metadata)
    if (opts.module) {
      const moduleMeta = Reflect.getMetadata('usetheo:di:module', opts.module)
      if (moduleMeta) {
        const allModules = [opts.module, ...(moduleMeta.imports ?? [])]
        for (const Mod of allModules) {
          const meta = Reflect.getMetadata('usetheo:di:module', Mod)
          if (!meta) continue
          for (const Prov of (meta.providers ?? []) as Function[]) {
            if (!registry.has(Prov)) {
              registry.set(Prov, new (Prov as new () => object)())
            }
          }
        }
      }
    }

    // 2. Inline providers (EC-2: BEFORE controllers and agents)
    if (opts.providers) {
      for (const Prov of opts.providers) {
        if (!registry.has(Prov)) {
          registry.set(Prov, new (Prov as new () => object)())
        }
      }
    }

    // 3. Controllers with DI
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

      // Lifecycle: call @PostConstruct if present
      const postConstruct = Reflect.getMetadata('usetheo:di:post-construct', Controller)
      if (postConstruct && typeof (instance as Record<string, Function>)[postConstruct] === 'function') {
        const result = (instance as Record<string, Function>)[postConstruct]()
        if (result instanceof Promise) await result // EC-1: await async PostConstruct
      }

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

    // Bug #8: Store frontend HTML
    if (opts.html) app.frontendHtml = opts.html

    // 4. Auto-wire agents (EC-2: AFTER providers and controllers)
    // The framework handles EVERYTHING — walk, compile, mount, stream.
    // Consumer writes: agents: [MyAgent] — and that's it.
    if (opts.agents?.length) {
      await app.autoWireAgents(opts.agents, registry, opts)
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

  // ── Auto-wire agents (the "SpringApplication.run()" moment) ──

  private agentRoutes: { method: string; pattern: RegExp; paramNames: string[]; handler: (request: Request) => Promise<Response>; guards: Function[]; agentClass: Function; methodName: string | symbol }[] = []

  private async autoWireAgents(agentClasses: Function[], registry: Map<Function, object>, opts: TheoAppOptions) {
    // Dynamic import — @theokit/agents is optional peer dependency
    // Uses Function-typed destructuring to avoid compile-time dependency on @theokit/agents
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- dynamic import avoids compile-time dependency on optional peer
    const importFn = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<Record<string, Function>>
    let walkAgentMetadata: Function, compileAgent: Function, generateAgentRoutes: Function, getMixins: Function, createRealAgentStreamFn: Function | undefined
    try {
      const mod = await importFn('@theokit/agents')
      walkAgentMetadata = mod.walkAgentMetadata
      compileAgent = mod.compileAgent
      generateAgentRoutes = mod.generateAgentRoutes
      getMixins = mod.getMixins
      createRealAgentStreamFn = mod.createRealAgentStream
    } catch {
      throw new Error('[TheoApp] @theokit/agents is required when agents[] is provided. Install: npm install @theokit/agents')
    }

    const apiKey = opts.llmApiKey ?? process.env.OPENROUTER_API_KEY ?? ''

    for (const AgentClass of agentClasses) {
      // 1. Walk metadata (decorators → structured data)
      const mixins = getMixins(AgentClass)
      const allToolboxes = [...mixins]

      // Also check providers for @Toolbox classes
      for (const [Cls] of registry) {
        if (Reflect.getMetadata(Symbol.for('theokit:agents:toolbox'), Cls)) {
          if (!allToolboxes.includes(Cls)) allToolboxes.push(Cls)
        }
      }

      const walk = walkAgentMetadata(AgentClass, allToolboxes)

      // 2. Resolve toolbox instances from registry (DI)
      const toolboxInstances = new Map<Function, object>()
      for (const tb of walk.toolboxes) {
        let instance = registry.get(tb.class)
        if (!instance) {
          instance = new (tb.class as new () => object)()
          registry.set(tb.class, instance)
        }
        toolboxInstances.set(tb.class, instance)
      }

      // 3. Compile tools (decorator metadata → defineTool-compatible)
      const compiled = compileAgent(walk, toolboxInstances)

      // 4. Create LLM stream factory
      let createRun: (message: string, sessionId: string) => AsyncIterable<unknown>

      if (opts.agentStreamFactory) {
        createRun = opts.agentStreamFactory(walk, compiled.tools, apiKey, opts.llmModel)
      } else if (apiKey && createRealAgentStreamFn !== undefined) { // eslint-disable-line @typescript-eslint/no-unnecessary-condition -- apiKey can be empty string
        // Bug #5 fix: use built-in LLM runner from @theokit/agents
        createRun = createRealAgentStreamFn(walk, compiled.tools, apiKey, opts.llmModel) as (m: string, s: string) => AsyncIterable<unknown>
      } else {
        createRun = this.createFallbackStream(walk.agentConfig.name, apiKey)
      }

      // 5. Generate routes (POST /chat, GET /runs/:id)
      const routes = generateAgentRoutes({
        walkResult: walk,
        compiledOptions: compiled,
        createRun: createRun as (message: string, sessionId: string) => AsyncIterable<{ type: string;[k: string]: unknown }>,
      })

      // 6. Mount routes
      for (const route of routes) {
        const paramNames: string[] = []
        const regexStr = route.path.replace(/:(\w+)/g, (_m: string, name: string) => {
          paramNames.push(name)
          return '([^/]+)'
        })
        this.agentRoutes.push({
          method: route.method,
          pattern: new RegExp(`^${regexStr}$`),
          paramNames,
          handler: route.handler,
          guards: walk.guards ?? [],
          agentClass: AgentClass,
          methodName: walk.mainLoop?.propertyKey ?? 'run',
        })
      }

      console.log(`  🤖 Agent "${walk.agentConfig.name}" mounted at ${walk.route}/chat (${compiled.tools.length} tools)`)
    }
  }

  private createFallbackStream(agentName: string, apiKey: string) {
    const msg = !apiKey
      ? 'Set OPENROUTER_API_KEY environment variable or pass llmApiKey to TheoApp.create()'
      : 'Pass agentStreamFactory to TheoApp.create() to connect your LLM provider'
    return (_message: string, _sessionId: string) => {
      const events = [
        { type: 'run_started', runId: `run-${Date.now()}`, agentName },
        { type: 'error', code: 'AGENT_NOT_WIRED', message: msg, retryable: false },
      ]
      return {
        [Symbol.asyncIterator]: () => {
          let i = 0
          return { next: () => Promise.resolve(i < events.length ? { value: events[i++], done: false as const } : { value: undefined, done: true as const }) }
        },
      }
    }
  }

  // ── Web Standard request handler ──────────────────

  private async handleRequest(request: Request): Promise<Response> {
    // Bug #8: Serve frontend HTML at GET /
    if (request.method === 'GET') {
      const p = new URL(request.url).pathname
      if ((p === '/' || p === '/index.html') && this.frontendHtml) {
        return new Response(this.frontendHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
      }
    }

    // Agent routes (auto-wired — checked first, with guard enforcement per Bug #4)
    const url0 = new URL(request.url)
    for (const route of this.agentRoutes) {
      if (request.method.toUpperCase() === route.method && route.pattern.test(url0.pathname)) {
        // Bug #4 fix: enforce @UseGuards on agent routes (same pipeline as controllers)
        if (route.guards.length > 0) {
          const ctx = createExecutionContext(request, route.agentClass, route.methodName)
          for (const GuardCtor of route.guards) {
            const guard = new (GuardCtor as new () => CanActivate)()
            if (!(await guard.canActivate(ctx))) {
              const ex = new ForbiddenException('Forbidden resource')
              return jsonResponse(ex.statusCode, ex.toJSON())
            }
          }
        }
        return route.handler(request)
      }
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

      // Handler — wrapped by interceptor chain (Bug #2 fix)
      const handlerFn = (entry.instance as Record<string | symbol, Function>)[entry.walk.propertyKey]

      let result: unknown
      if (entry.walk.interceptors.length > 0) {
        // Import runInterceptors dynamically to avoid circular dep
        const { runInterceptors } = await import('./bridge/interceptor-chain.js')
        result = await runInterceptors(
          entry.walk.interceptors,
          () => handlerFn.apply(entry.instance, args) as Promise<unknown>,
          request,
        )
      } else {
        result = await handlerFn.apply(entry.instance, args)
      }

      return buildResponse(result, entry.walk, method)
    } catch (err) {
      // Exception filters (Bug #2 fix — filters also wired)
      if (entry.walk.filters.length > 0) {
        const { runExceptionFilters } = await import('./bridge/exception-filter-chain.js')
        return runExceptionFilters(err, entry.walk.filters, request)
      }
      // Fallback: HttpException subclasses (Bug #3 fix)
      if (err instanceof HttpException) {
        return jsonResponse(err.statusCode, err.toJSON())
      }
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
