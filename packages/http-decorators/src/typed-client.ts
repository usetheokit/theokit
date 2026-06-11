/**
 * Typed Client — end-to-end type inference from @Controller decorators.
 *
 * The developer defines route contracts on the server, and the client
 * gets full autocomplete + type checking — zero code generation, zero
 * runtime overhead.
 *
 * @example Server:
 * ```ts
 * const routes = {
 *   'GET /api/tasks':    { response: [] as Task[] },
 *   'POST /api/tasks':   { body: zCreateTask, response: {} as Task },
 *   'GET /api/tasks/:id': { params: { id: 'string' }, response: {} as Task },
 *   'DELETE /api/tasks/:id': { params: { id: 'string' }, response: void 0 as void },
 * } satisfies RouteMap
 * export type AppRoutes = typeof routes
 * ```
 *
 * @example Client:
 * ```ts
 * import type { AppRoutes } from '../server/routes.js'
 * const client = createTypedClient<AppRoutes>('http://localhost:3000')
 * const tasks = await client.get('/api/tasks')       // Task[]
 * const task = await client.post('/api/tasks', body)  // Task
 * ```
 */
import { z } from 'zod'

// ── Route Map types ──

export interface RouteDefinition {
  body?: z.ZodType
  params?: Record<string, 'string' | 'number'>
  query?: Record<string, 'string' | 'number' | 'boolean'>
  response: unknown
}

export type RouteMap = Record<string, RouteDefinition>

// ── Type extraction helpers ──

type ExtractRoutes<M extends RouteMap, Method extends string> = {
  [K in keyof M & string as K extends `${Method} ${infer Path}` ? Path : never]: M[K]
}

type InferBody<D extends RouteDefinition> = D['body'] extends z.ZodType ? z.infer<D['body']> : never
type InferResponse<D extends RouteDefinition> = D['response']

type HasBody<D extends RouteDefinition> = D['body'] extends z.ZodType ? true : false

// ── Client interface ──

export interface TypedClient<M extends RouteMap> {
  get<P extends keyof ExtractRoutes<M, 'GET'> & string>(
    path: P,
    opts?: { query?: Record<string, string>; headers?: Record<string, string> },
  ): Promise<InferResponse<ExtractRoutes<M, 'GET'>[P]>>

  post<P extends keyof ExtractRoutes<M, 'POST'> & string>(
    path: P,
    ...args: HasBody<ExtractRoutes<M, 'POST'>[P]> extends true
      ? [body: InferBody<ExtractRoutes<M, 'POST'>[P]>, opts?: { headers?: Record<string, string> }]
      : [opts?: { headers?: Record<string, string> }]
  ): Promise<InferResponse<ExtractRoutes<M, 'POST'>[P]>>

  put<P extends keyof ExtractRoutes<M, 'PUT'> & string>(
    path: P,
    body: InferBody<ExtractRoutes<M, 'PUT'>[P]>,
    opts?: { headers?: Record<string, string> },
  ): Promise<InferResponse<ExtractRoutes<M, 'PUT'>[P]>>

  delete<P extends keyof ExtractRoutes<M, 'DELETE'> & string>(
    path: P,
    opts?: { headers?: Record<string, string> },
  ): Promise<InferResponse<ExtractRoutes<M, 'DELETE'>[P]>>
}

// ── Client factory ──

export function createTypedClient<M extends RouteMap>(
  baseUrl: string,
  defaultHeaders?: Record<string, string>,
): TypedClient<M> {
  async function request(method: string, path: string, body?: unknown, opts?: { headers?: Record<string, string>; query?: Record<string, string> }) {
    const url = new URL(path, baseUrl)
    if (opts?.query) {
      for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v)
    }
    const headers: Record<string, string> = {
      ...defaultHeaders,
      ...opts?.headers,
    }
    if (body !== undefined) headers['content-type'] = 'application/json'

    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }))
      throw new TypedClientError(res.status, error as Record<string, unknown>)
    }

    if (res.status === 204) return undefined
    return res.json()
  }

  return {
    get: (path, opts) => request('GET', path, undefined, opts),
    post: (path, ...args) => {
      const hasBody = args.length > 0 && typeof args[0] !== 'object'
        ? false
        : args[0] !== undefined && !('headers' in (args[0] as Record<string, unknown> ?? {}))
      if (hasBody) return request('POST', path, args[0], args[1] as { headers?: Record<string, string> })
      return request('POST', path, undefined, args[0] as { headers?: Record<string, string> })
    },
    put: (path, body, opts) => request('PUT', path, body, opts),
    delete: (path, opts) => request('DELETE', path, undefined, opts),
  } as TypedClient<M>
}

export class TypedClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(`HTTP ${status}: ${JSON.stringify(body)}`)
    this.name = 'TypedClientError'
  }
}
