import { describe, expect, it, vi } from 'vitest'

import { createAppClient } from '../../packages/theo/src/client/app-client.js'
import { TheoFetchError } from '../../packages/theo/src/client/theo-fetch.js'

/**
 * Phase 5 of G1 — error envelope alignment.
 *
 * No code change here; this suite pins the contract that errors from the
 * underlying `theoFetch` (and any future server envelope shape — G5) reach
 * the typed-client consumer as `TheoFetchError` instances with the expected
 * fields populated (`status`, `code`, `issues`).
 */

interface AppClient {
  posts: {
    post: (opts: any) => Promise<any>
    get: () => Promise<any>
  }
}

describe('typed-client → TheoFetchError propagation', () => {
  it('4xx with `{error:{code,message}}` envelope reaches consumer as TheoFetchError with code', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(
      new TheoFetchError(422, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'name is required',
          issues: [{ path: ['name'], message: 'required' }],
        },
      }),
    )
    const client = createAppClient<AppClient>({ fetchImpl: fetchImpl as any })
    let captured: unknown
    try {
      await client.posts.post({ body: {} })
    } catch (err) {
      captured = err
    }
    expect(captured).toBeInstanceOf(TheoFetchError)
    const err = captured as TheoFetchError
    expect(err.status).toBe(422)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.issues).toEqual([{ path: ['name'], message: 'required' }])
    expect(err.message).toBe('name is required')
  })

  it('5xx without body throws TheoFetchError with status only', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TheoFetchError(503))
    const client = createAppClient<AppClient>({ fetchImpl: fetchImpl as any })
    await expect(client.posts.get()).rejects.toMatchObject({
      name: 'TheoFetchError',
      status: 503,
    })
  })

  it('401 unauthorized propagates with `code` populated', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(
      new TheoFetchError(401, { error: { code: 'UNAUTHORIZED', message: 'session expired' } }),
    )
    const client = createAppClient<AppClient>({ fetchImpl: fetchImpl as any })
    await expect(client.posts.get()).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    })
  })

  it('network error (non-TheoFetchError) propagates as a different error class', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('NetworkError: fetch failed'))
    const client = createAppClient<AppClient>({ fetchImpl: fetchImpl as any })
    let captured: unknown
    try {
      await client.posts.get()
    } catch (err) {
      captured = err
    }
    expect(captured).toBeInstanceOf(TypeError)
    expect(captured).not.toBeInstanceOf(TheoFetchError)
  })
})
