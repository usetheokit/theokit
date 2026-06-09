/* eslint-disable security/detect-non-literal-regexp */
/**
 * TheoKit integration plugin for @theokit/http-decorators.
 *
 * Registers an `onRequest` hook that intercepts requests matching
 * decorator-defined routes BEFORE TheoKit's file-based route scanner
 * processes them. Same integration pattern as @theokit/plugin-openapi.
 *
 * Usage in theo.config.ts:
 *
 * ```ts
 * import { defineConfig } from 'theokit/server'
 * import { httpDecoratorsPlugin } from '@theokit/http-decorators/theokit-plugin'
 * import { CatsController } from './server/controllers/cats.controller.js'
 *
 * export default defineConfig({
 *   plugins: [
 *     httpDecoratorsPlugin({ controllers: [CatsController] })
 *   ]
 * })
 * ```
 */
import 'reflect-metadata'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { walkControllerMetadata, type WalkResult } from './bridge/walk-metadata.js'
import type { ParamEntry } from './decorators/params.js'

export interface HttpDecoratorsPluginOptions {
  controllers: Function[]
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
  // Dedupe controllers (EC-5)
  const seen = new Set<Function>()
  const unique: Function[] = []
  for (const Ctor of opts.controllers) {
    if (seen.has(Ctor)) continue
    seen.add(Ctor)
    unique.push(Ctor)
  }

  // Walk metadata and build route table at plugin creation time (once)
  const routes: RouteEntry[] = []
  for (const Ctor of unique) {
    const instance = new (Ctor as new () => object)()
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

  return {
    name: '@theokit/http-decorators',
    register(app: {
      addHook: (
        name: string,
        fn: (ctx: {
          request: IncomingMessage
          response: ServerResponse
          ctx: Record<string, unknown>
        }) => Promise<void>,
      ) => void
    }) {
      app.addHook('onRequest', async (pluginCtx) => {
        await handleDecoratorRoute(routes, pluginCtx.request, pluginCtx.response)
      })
    },
  }
}

// ─── Request handler (extracted for complexity budget) ──

async function handleDecoratorRoute(
  routes: RouteEntry[],
  req: IncomingMessage,
  res: ServerResponse,
) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const method = (req.method ?? 'GET').toUpperCase()
  const match = findMatch(routes, method, url.pathname)
  if (!match) return // Not our route — fall through to TheoKit's scanner

  const { entry, params } = match
  const { walk, instance } = entry

  try {
    if (await runGuards(walk.guards, req, res)) return
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
    writeJson(res, 500, { error: { code: 'INTERNAL_SERVER_ERROR', message } })
  }
}

async function runGuards(
  guards: Function[],
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  for (const GuardCtor of guards) {
    const guard = new (GuardCtor as new () => {
      canActivate: (r: IncomingMessage) => boolean | Promise<boolean>
    })()
    if (!(await guard.canActivate(req))) {
      writeJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Guard rejected' } })
      return true
    }
  }
  return false
}

const BODY_REJECTED = Symbol('body-rejected')

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
      writeJson(res, 422, { error: { code: 'VALIDATION_ERROR', issues: result.error.issues } })
      return BODY_REJECTED
    }
    body = result.data
  }
  return body
}

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
  writeJson(res, status, result, headers)
}

// ─── Helpers ──────────────────────────────────────────

function writeJson(
  res: ServerResponse,
  status: number,
  data: unknown,
  extraHeaders?: Record<string, string>,
) {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...extraHeaders }
  res.writeHead(status, headers)
  res.end(JSON.stringify(data))
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
      default:
        args[p.index] = undefined
    }
  }
  return args
}
