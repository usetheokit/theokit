/**
 * M7-2 — health/ready routes on the convention server.
 *
 * `defineHealthRoute`/`defineReadyRoute` produce reserved-route configs; the
 * pure `serveReservedRoute` dispatcher maps `/__theo/health` to 200 and
 * `/__theo/ready` to 200/503 from a probe (a throwing probe -> 503), and
 * returns null for any non-reserved path (so the user catch-all + 404 win).
 */
import { describe, expect, it } from 'vitest'

import {
  defineHealthRoute,
  defineReadyRoute,
  HEALTH_PATH,
  READY_PATH,
  serveReservedRoute,
} from '../../packages/theo/src/server/define/health-route.js'

describe('M7-2 health/ready reserved routes', () => {
  it('serves /__theo/health as 200 {status:"ok"} by default', async () => {
    const res = await serveReservedRoute(HEALTH_PATH, {})
    expect(res).not.toBeNull()
    expect(res?.status).toBe(200)
    expect(res?.body).toEqual({ status: 'ok' })
  })

  it('serves /__theo/ready as 200 {status:"ready"} when the probe resolves true', async () => {
    const res = await serveReservedRoute(READY_PATH, { ready: defineReadyRoute(() => true) })
    expect(res?.status).toBe(200)
    expect(res?.body).toEqual({ status: 'ready' })
  })

  it('serves /__theo/ready as 503 {status:"not-ready"} when the probe resolves false', async () => {
    const res = await serveReservedRoute(READY_PATH, { ready: defineReadyRoute(() => false) })
    expect(res?.status).toBe(503)
    expect(res?.body).toEqual({ status: 'not-ready' })
  })

  it('serves /__theo/ready as 503 when the probe throws (no 500 crash)', async () => {
    const res = await serveReservedRoute(READY_PATH, {
      ready: defineReadyRoute(() => {
        throw new Error('dependency down')
      }),
    })
    expect(res?.status).toBe(503)
  })

  it('returns null for a non-reserved path so the user catch-all + 404 take over', async () => {
    expect(await serveReservedRoute('/users', {})).toBeNull()
    expect(await serveReservedRoute('/__theo/other', {})).toBeNull()
  })

  it('uses a custom health handler body when provided', async () => {
    const res = await serveReservedRoute(HEALTH_PATH, {
      health: defineHealthRoute(() => ({ status: 'ok', version: '1.2.3' })),
    })
    expect(res?.body).toEqual({ status: 'ok', version: '1.2.3' })
  })
})
