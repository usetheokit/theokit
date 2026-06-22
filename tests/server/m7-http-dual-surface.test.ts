/**
 * M7 — Integration Validation (Phase 4).
 *
 * Composes the full Tema F chain through the public `theokit/boot` surface: a
 * single in-process fetch handle (no socket) serves the reserved health/ready
 * routes (M7-2) and a typed 404 envelope (M7-1) for unknown paths, with a
 * readiness probe flipping 200 -> 503. The "eat your own cooking" gate for M7.
 */
import { describe, expect, it } from 'vitest'

import { createConventionFetchHandler } from '../../packages/theo/src/server/boot.js'
import {
  defineHealthRoute,
  defineReadyRoute,
} from '../../packages/theo/src/server/define/health-route.js'

describe('M7 dual-surface — full chain via theokit/boot', () => {
  it('serves health, readiness and a typed 404 from one booted handle', async () => {
    let dependencyReady = false
    const app = createConventionFetchHandler({
      reservedRoutes: {
        health: defineHealthRoute(() => ({ status: 'ok', service: 'demo' })),
        ready: defineReadyRoute(() => dependencyReady),
      },
    })

    // M7-2 liveness — always up.
    const health = await app.fetch(new Request('http://localhost/__theo/health'))
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ status: 'ok', service: 'demo' })

    // M7-2 readiness — 503 while the dependency is down...
    const notReady = await app.fetch(new Request('http://localhost/__theo/ready'))
    expect(notReady.status).toBe(503)
    expect((await notReady.json()).status).toBe('not-ready')

    // ...then 200 once it comes up (same handle, live probe).
    dependencyReady = true
    const ready = await app.fetch(new Request('http://localhost/__theo/ready'))
    expect(ready.status).toBe(200)
    expect((await ready.json()).status).toBe('ready')

    // M7-1 typed 404 envelope for an unknown route.
    const missing = await app.fetch(new Request('http://localhost/api/nope'))
    expect(missing.status).toBe(404)
    const body = await missing.json()
    expect(body.code).toBe('NOT_FOUND')
    expect(typeof body.message).toBe('string')

    await app.close()
  })
})
