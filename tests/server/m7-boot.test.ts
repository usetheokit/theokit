/**
 * M7-3 — programmatic boot via `theokit/boot`.
 *
 * `createConventionFetchHandler` returns a socketless `{ fetch, close }` handle
 * that serves the convention server's reserved health/ready routes (M7-2) and a
 * typed 404 envelope (M7-1) for unknown paths — the in-process surface used by
 * embedders + tests (no port bound). `close` is idempotent.
 */
import { describe, expect, it } from 'vitest'

import { defineReadyRoute } from '../../packages/theo/src/server/define/health-route.js'
import { createConventionFetchHandler } from '../../packages/theo/src/server/boot.js'

describe('M7-3 theokit/boot — createConventionFetchHandler', () => {
  it('answers an in-process fetch for /__theo/health with 200 {status:"ok"}', async () => {
    const app = createConventionFetchHandler()
    const res = await app.fetch(new Request('http://localhost/__theo/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('returns a typed 404 envelope for an unknown route', async () => {
    const app = createConventionFetchHandler()
    const res = await app.fetch(new Request('http://localhost/does-not-exist'))
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('NOT_FOUND')
  })

  it('serves /__theo/ready as 503 when the configured probe is not ready', async () => {
    const app = createConventionFetchHandler({
      reservedRoutes: { ready: defineReadyRoute(() => false) },
    })
    const res = await app.fetch(new Request('http://localhost/__theo/ready'))
    expect(res.status).toBe(503)
  })

  it('close() is idempotent', async () => {
    const app = createConventionFetchHandler()
    await app.close()
    await expect(app.close()).resolves.toBeUndefined()
  })
})
