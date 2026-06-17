import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { executeWebRequest } from '../../packages/theo/src/server/web-handler.js'

/**
 * T3.1 — executeWebRequest must resolve route params from opts.params (the
 * matchRoute result) instead of the previously-hardcoded `{}`. Backward compat:
 * when opts.params is omitted, behavior is unchanged.
 */
function userRoute() {
  return {
    GET: {
      params: z.object({ id: z.string() }),
      handler: ({ params }: { params: unknown }) => ({ seen: (params as { id: string }).id }),
    },
  }
}

describe('executeWebRequest route params (T3.1)', () => {
  it('test_web_handler_receives_resolved_params', async () => {
    const res = await executeWebRequest(new Request('http://x/users/42'), userRoute(), {
      params: { id: '42' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ seen: '42' })
  })

  it('test_web_handler_validates_params_via_zod', async () => {
    const route = {
      GET: {
        params: z.object({ id: z.coerce.number().int() }),
        handler: () => ({ ok: true }),
      },
    }
    const res = await executeWebRequest(new Request('http://x/users/abc'), route, {
      params: { id: 'abc' },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    const body = await res.json()
    expect(JSON.stringify(body)).toMatch(/validation|params/i)
  })

  it('test_web_handler_params_default_empty_preserves_compat', async () => {
    // No opts.params → paramsRaw {} → a route requiring params fails validation (prior behavior).
    const res = await executeWebRequest(new Request('http://x/users/42'), userRoute())
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('test_web_handler_catchall_param_preserves_slashes', async () => {
    const route = {
      GET: {
        params: z.object({ path: z.string() }),
        handler: ({ params }: { params: unknown }) => ({ path: (params as { path: string }).path }),
      },
    }
    const res = await executeWebRequest(new Request('http://x/docs/a/b/c'), route, {
      params: { path: 'a/b/c' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ path: 'a/b/c' })
  })
})
