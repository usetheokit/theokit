/**
 * Typed Client — end-to-end type inference from route contracts.
 *
 * Zero codegen, zero runtime overhead on types. The developer defines
 * a route map using `contract()`, and `createTypedClient<T>()` infers
 * request body + response types automatically.
 */
import type { z } from 'zod'

// ── Route Map types ──

export interface RouteDefinition {
  body?: z.ZodType
  params?: Record<string, 'string' | 'number'>
  query?: Record<string, 'string' | 'number' | 'boolean'>
  response: unknown
}

export type RouteMap = Record<string, RouteDefinition>

// ── Type extraction ──

type InferBody<D> = D extends { body: z.ZodType } ? z.infer<D['body']> : never
type InferResponse<D> = D extends { response: infer R } ? R : unknown

// ── Client interface (simplified — works with strict DTS) ──

export interface TypedClient<M extends RouteMap> {
  get<P extends string & keyof M>(
    path: P,
    opts?: { query?: Record<string, string>; headers?: Record<string, string> },
  ): Promise<InferResponse<M[`GET ${P}`] extends never ? M[P] : M[`GET ${P}`]>>

  post<P extends string>(
    path: P,
    body?: InferBody<M[`POST ${P}`]>,
    opts?: { headers?: Record<string, string> },
  ): Promise<InferResponse<M[`POST ${P}`]>>

  put<P extends string>(
    path: P,
    body?: InferBody<M[`PUT ${P}`]>,
    opts?: { headers?: Record<string, string> },
  ): Promise<InferResponse<M[`PUT ${P}`]>>

  delete<P extends string>(
    path: P,
    opts?: { headers?: Record<string, string> },
  ): Promise<InferResponse<M[`DELETE ${P}`]>>
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
    const headers: Record<string, string> = { ...defaultHeaders, ...opts?.headers }
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
    get: (path: string, opts?: Record<string, unknown>) => request('GET', path, undefined, opts as { headers?: Record<string, string>; query?: Record<string, string> }),
    post: (path: string, body?: unknown, opts?: Record<string, unknown>) => request('POST', path, body, opts as { headers?: Record<string, string> }),
    put: (path: string, body?: unknown, opts?: Record<string, unknown>) => request('PUT', path, body, opts as { headers?: Record<string, string> }),
    delete: (path: string, opts?: Record<string, unknown>) => request('DELETE', path, undefined, opts as { headers?: Record<string, string> }),
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
