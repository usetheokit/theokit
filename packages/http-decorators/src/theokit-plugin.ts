/* eslint-disable security/detect-non-literal-regexp */
/**
 * TheoKit integration plugin for @theokit/http-decorators.
 *
 * Two modes:
 *
 * **Mode 1 — controllersGlob (RECOMMENDED):**
 * Controllers are discovered by glob pattern and loaded via @swc/core at
 * first request. This bypasses the esbuild parameter-decorator limitation
 * because controller files are never imported through tsx/esbuild.
 *
 * ```ts
 * // theo.config.ts — NO controller import needed
 * import { defineConfig } from 'theokit/server'
 * import { httpDecoratorsPlugin } from '@theokit/http-decorators/theokit-plugin'
 *
 * export default defineConfig({
 *   plugins: [
 *     httpDecoratorsPlugin({
 *       controllersGlob: 'server/controllers/**\/*.controller.ts'
 *     })
 *   ]
 * })
 * ```
 *
 * **Mode 2 — direct controllers array (tests, pre-compiled):**
 * Pass controller classes directly. Only works when the transpiler
 * supports parameter decorators (e.g., SWC in Vitest, or manual
 * Reflect.defineMetadata in tests).
 *
 * ```ts
 * httpDecoratorsPlugin({ controllers: [CatsController] })
 * ```
 */
import 'reflect-metadata'

import { resolveOrNew, type DiContainer } from './bridge/di-resolve.js'
import { runExceptionFilters } from './bridge/exception-filter-chain.js'
import { createExecutionContext, type CanActivate, type ExecutionContext } from './bridge/execution-context.js'
import { runInterceptors } from './bridge/interceptor-chain.js'
import {
  MiddlewareConsumerImpl,
  runMiddleware,
  type ResolvedMiddleware,
} from './bridge/middleware-consumer.js'
import { nodeIncomingToRequest, writeResponseToNode } from './bridge/runtime/node.js'
import { loadControllersFromGlob } from './bridge/swc-loader.js'
import { walkControllerMetadata, type WalkResult } from './bridge/walk-metadata.js'
import type { ParamEntry } from './decorators/params.js'
import { ForbiddenException } from './exceptions/http-exception.js'

export interface HttpDecoratorsPluginOptions {
  /** Direct controller class references (Mode 2 — tests, pre-compiled). */
  controllers?: Function[]
  /** Glob pattern relative to project root (Mode 1 — RECOMMENDED).
   *  Example: 'server/controllers/**\/*.controller.ts'
   *  Requires @swc/core as devDependency. */
  controllersGlob?: string
  /** Optional DI container (e.g., @theokit/di Container). */
  container?: DiContainer
  /** NestJS-style middleware configuration callback. */
  configure?: (consumer: MiddlewareConsumerImpl) => void
}

interface RouteEntry {
  walk: WalkResult
  instance: object
  regex: RegExp
  paramNames: string[]
}

/**
 * TheoKit plugin that mounts decorated controllers into the `theokit dev`
 * / `theokit start` request pipeline via the `onRequest` hook.
 *
 * Returns a plain `{ name, register }` object compatible with
 * `TheoPlugin` from `theokit/server` (Pattern D6 — we don't import the
 * type to avoid adding theokit as a compile-time dep; the structural
 * shape is sufficient).
 */
export function httpDecoratorsPlugin(opts: HttpDecoratorsPluginOptions) {
  const routes: RouteEntry[] = []
  let initialized = false
  let initPromise: Promise<void> | null = null

  // Collect middleware via configure() callback (NestJS pattern)
  const middlewareConsumer = new MiddlewareConsumerImpl(opts.container)
  if (opts.configure) opts.configure(middlewareConsumer)
  const middlewareEntries = middlewareConsumer.getEntries()

  // Mode 2: Direct class references — initialize eagerly
  if (opts.controllers && opts.controllers.length > 0) {
    buildRouteTable(routes, opts.controllers, opts.container)
    initialized = true
  }

  // Mode 1: controllersGlob — defer initialization to first request
  if (opts.controllersGlob && !initialized) {
    const glob = opts.controllersGlob
    initPromise = (async () => {
      // Resolve root from process.cwd() — the TheoKit project root
      const rootDir = process.cwd()
      const controllers = await loadControllersFromGlob(rootDir, glob)
      buildRouteTable(routes, controllers, opts.container)
      initialized = true
      console.log(
        `[@theokit/http-decorators] Loaded ${controllers.length} controller(s) ` +
          `with ${routes.length} route(s) via SWC.`,
      )
    })()
  }

  return {
    name: '@theokit/http-decorators',
    register(app: {
      addHook: (
        name: string,
        fn: (ctx: Record<string, unknown>) => Promise<void>,
      ) => void
    }) {
      app.addHook('onRequest', async (pluginCtx) => {
        if (initPromise && !initialized) await initPromise

        // Convert Node types → Web Standard at the boundary
        const _nodeHttp = await import('node:http')
        const request = nodeIncomingToRequest(pluginCtx.request as InstanceType<typeof _nodeHttp.IncomingMessage>)
        const response = await handleDecoratorRoute(routes, request, opts.container, middlewareEntries)
        if (response) {
          await writeResponseToNode(response, pluginCtx.response as InstanceType<typeof _nodeHttp.ServerResponse>)
        }
        // null = not our route, fall through to TheoKit scanner
      })
    },
  }
}

// ─── Route table builder ─────────────────────────────────

function buildRouteTable(
  routes: RouteEntry[],
  controllers: Function[],
  container?: DiContainer,
): void {
  // Dedupe controllers (EC-5)
  const seen = new Set<Function>()
  const unique: Function[] = []
  for (const Ctor of controllers) {
    if (seen.has(Ctor)) continue
    seen.add(Ctor)
    unique.push(Ctor)
  }

  for (const Ctor of unique) {
    const instance = resolveOrNew(Ctor, container)
    const walks = walkControllerMetadata(Ctor)
    for (const w of walks) {
      const { regex, paramNames } = compilePattern(w.fullPath)
      routes.push({ walk: w, instance, regex, paramNames })
    }
  }

  // Sort: static routes first, parameterized last (prevents /cats/:id matching "admin")
  routes.sort((a, b) => {
    const aHasParam = a.walk.fullPath.includes(':')
    const bHasParam = b.walk.fullPath.includes(':')
    if (aHasParam !== bHasParam) return aHasParam ? 1 : -1
    return 0
  })
}

// ─── Request handler (extracted for complexity budget) ──

/** Returns Response if handled, null if not our route. */
async function handleDecoratorRoute(
  routes: RouteEntry[],
  request: Request,
  container?: DiContainer,
  mwEntries: ResolvedMiddleware[] = [],
): Promise<Response | null> {
  const url = new URL(request.url)
  const method = request.method.toUpperCase()
  const match = findMatch(routes, method, url.pathname)
  if (!match) return null

  const { entry, params } = match
  const { walk, instance } = entry

  try {
    const mwResponse = await runMiddleware(mwEntries, request, url.pathname)
    if (mwResponse) return mwResponse

    const ctx = createExecutionContext(request, instance.constructor, walk.propertyKey)
    const guardResponse = await runGuards(walk.guards, ctx, container)
    if (guardResponse) return guardResponse

    const body = await resolveBody(method, request, walk)
    if (body instanceof Response) return body

    const args = buildArgs(walk.paramEntries, {
      request,
      body,
      params,
      query: Object.fromEntries(url.searchParams),
    })

    if (walk.redirect) {
      return new Response(null, { status: walk.redirect.status, headers: { location: walk.redirect.url } })
    }

    const handlerFn = (instance as Record<string | symbol, Function>)[walk.propertyKey]
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

async function runGuards(
  guards: Function[],
  context: ExecutionContext,
  container?: DiContainer,
): Promise<Response | null> {
  for (const GuardCtor of guards) {
    const guard = resolveOrNew(GuardCtor, container) as CanActivate
    if (!(await guard.canActivate(context))) {
      const ex = new ForbiddenException('Forbidden resource')
      return jsonResponse(ex.statusCode, ex.toJSON())
    }
  }
  return null
}

async function resolveBody(method: string, request: Request, walk: WalkResult): Promise<unknown> {
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return undefined
  let body: unknown
  try {
    const text = await request.text()
    body = text ? JSON.parse(text) : undefined
  } catch { body = undefined }
  if (walk.bodySchema && body !== undefined) {
    const result = walk.bodySchema.safeParse(body)
    if (!result.success) {
      return jsonResponse(422, { error: { code: 'VALIDATION_ERROR', issues: result.error.issues } })
    }
    body = result.data
  }
  return body
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function findMatch(
  routes: RouteEntry[],
  method: string,
  pathname: string,
): { entry: RouteEntry; params: Record<string, string> } | null {
  for (const entry of routes) {
    if (entry.walk.verb !== 'ALL' && entry.walk.verb !== method) continue
    const match = pathname.match(entry.regex)
    if (!match) continue
    const params: Record<string, string> = {}
    entry.paramNames.forEach((name, i) => {
      params[name] = match[i + 1]
    })
    return { entry, params }
  }
  return null
}

function compilePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = []
  const regexStr = pattern.replace(/:(\w+)/g, (_m, name: string) => {
    paramNames.push(name)
    return '([^/]+)'
  })
  return { regex: new RegExp(`^${regexStr}$`), paramNames }
}

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
      default:
        args[p.index] = undefined
    }
  }
  return args
}

// resolveOrNew imported from ./bridge/di-resolve.ts (DRY — EC-3)
