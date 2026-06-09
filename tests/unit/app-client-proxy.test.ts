import { describe, expect, it, vi } from 'vitest'

import { createAppClient } from '../../packages/theo/src/client/app-client.js'
import { TheoFetchError } from '../../packages/theo/src/client/theo-fetch.js'

type FetchCall = { url: string; init: Record<string, unknown> }
function makeMockFetch() {
  const calls: FetchCall[] = []
  const impl = vi.fn(async (url: string, init?: Record<string, unknown>) => {
    calls.push({ url, init: init ?? {} })
    return { ok: true, mocked: true } as unknown
  }) as unknown as Parameters<typeof createAppClient>[1]
  return { impl, calls }
}

interface AppClient {
  posts: {
    get: (opts?: any) => Promise<any>
    post: (opts?: any) => Promise<any>
    id: { get: (opts: { params: { id: string } }) => Promise<any> }
  }
  health: { get: () => Promise<any> }
  userProfiles: { get: () => Promise<any> }
}

describe('createAppClient — Proxy facade over theoFetch', () => {
  it('traverses segments + applies HTTP method → fetchImpl called with built URL', async () => {
    const { impl, calls } = makeMockFetch()
    const client = createAppClient<AppClient>({ baseUrl: '/api', fetchImpl: impl as any })
    await client.posts.get()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/posts')
    expect((calls[0].init as { method: string }).method).toBe('GET')
  })

  it('uses default baseUrl `/api` when not provided', async () => {
    const { impl, calls } = makeMockFetch()
    const client = createAppClient<AppClient>(undefined, impl as any)
    await client.health.get()
    expect(calls[0].url).toBe('/api/health')
  })

  it('strips trailing slash from baseUrl', async () => {
    const { impl, calls } = makeMockFetch()
    const client = createAppClient<AppClient>({ baseUrl: '/api/', fetchImpl: impl as any })
    await client.posts.get()
    expect(calls[0].url).toBe('/api/posts')
  })

  it('GET passes opts.query through to fetchImpl', async () => {
    const { impl, calls } = makeMockFetch()
    const client = createAppClient<AppClient>({ fetchImpl: impl as any })
    await client.posts.get({ query: { limit: 10 } })
    expect((calls[0].init as { query: unknown }).query).toEqual({ limit: 10 })
    expect((calls[0].init as { method: string }).method).toBe('GET')
  })

  it('POST passes opts.body through to fetchImpl', async () => {
    const { impl, calls } = makeMockFetch()
    const client = createAppClient<AppClient>({ fetchImpl: impl as any })
    await client.posts.post({ body: { title: 'hi' } })
    expect((calls[0].init as { body: unknown }).body).toEqual({ title: 'hi' })
    expect((calls[0].init as { method: string }).method).toBe('POST')
  })

  it('lowercase method on Proxy becomes uppercase in the request', async () => {
    const { impl, calls } = makeMockFetch()
    const client = createAppClient<AppClient>({ fetchImpl: impl as any })
    await client.posts.get()
    expect((calls[0].init as { method: string }).method).toBe('GET')
  })

  it('EC-7: opts.signal propagates to fetchImpl unchanged', async () => {
    const { impl, calls } = makeMockFetch()
    const client = createAppClient<AppClient>({ fetchImpl: impl as any })
    const ctrl = new AbortController()
    await client.posts.get({ signal: ctrl.signal })
    expect((calls[0].init as { signal: AbortSignal }).signal).toBe(ctrl.signal)
  })

  it('injects path params from opts.params', async () => {
    const { impl, calls } = makeMockFetch()
    const client = createAppClient<AppClient>({ fetchImpl: impl as any })
    await client.posts.id.get({ params: { id: '42' } })
    expect(calls[0].url).toBe('/api/posts/42')
  })

  it('without params, segments are treated as literals (runtime cannot tell dynamic from static; TS .d.ts is the gate)', async () => {
    const { impl, calls } = makeMockFetch()
    const client = createAppClient<AppClient>({ fetchImpl: impl as any })
    // No params → literal URL → server returns 404 if no route matches /api/posts/id literal.
    await client.posts.id.get({} as any)
    expect(calls[0].url).toBe('/api/posts/id')
  })

  it('throws MISSING_PARAM when an opts.params key matches a segment but its value is empty', async () => {
    const { impl } = makeMockFetch()
    const client = createAppClient<AppClient>({ fetchImpl: impl as any })
    await expect(
      client.posts.id.get({ params: { id: '' as any } }),
    ).rejects.toThrow(/MISSING_PARAM|required/i)
  })

  it('rejects top-level method call (no segment)', async () => {
    const { impl } = makeMockFetch()
    const client = createAppClient<{ get: () => Promise<any> }>({ fetchImpl: impl as any })
    await expect(client.get()).rejects.toBeInstanceOf(TheoFetchError)
  })

  it('rejects when client(...) is called directly (apply trap)', async () => {
    const { impl } = makeMockFetch()
    const client = createAppClient<(...a: unknown[]) => unknown>({ fetchImpl: impl as any })
    await expect((client as any)()).rejects.toBeInstanceOf(TheoFetchError)
  })

  it('EC-1: client.posts.then returns undefined (not thenable)', () => {
    const client = createAppClient<AppClient>({ fetchImpl: vi.fn() as any })
    const post = client.posts as unknown as { then?: unknown }
    expect(post.then).toBeUndefined()
  })

  it('EC-1: await on a Proxy resolves with the Proxy itself (no infinite loop)', async () => {
    const client = createAppClient<AppClient>({ fetchImpl: vi.fn() as any })
    // If `then` were intercepted, this would loop indefinitely. We assert
    // resolution within a normal microtask.
    const resolved = await Promise.race([
      Promise.resolve(client.posts),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 200)),
    ])
    expect(typeof resolved).toBe('function')
  })

  it('EC-1: Symbol keys (Symbol.iterator etc.) return undefined', () => {
    const client = createAppClient<AppClient>({ fetchImpl: vi.fn() as any })
    expect((client as any)[Symbol.iterator]).toBeUndefined()
    expect((client as any)[Symbol.asyncIterator]).toBeUndefined()
  })

  it('EC-1: toJSON returns undefined → JSON.stringify produces "undefined"', () => {
    const client = createAppClient<AppClient>({ fetchImpl: vi.fn() as any })
    expect(JSON.stringify({ a: (client as any).toJSON })).toBe('{}')
  })

  it('EC-2 wire-through: route registered as `user-profiles` reaches `client.userProfiles`', async () => {
    // codegen handles kebab→camel (Phase 2 test). Runtime simply walks
    // whatever property name the codegen produced.
    const { impl, calls } = makeMockFetch()
    const client = createAppClient<AppClient>({ fetchImpl: impl as any })
    await client.userProfiles.get()
    expect(calls[0].url).toBe('/api/userProfiles')
  })
})
