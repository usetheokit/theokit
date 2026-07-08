/**
 * M31 Phase 3 — `plugin()` fluent builder. `.build()` SYNTHESIZES a `TheoPlugin` whose `register`
 * wires the collected hooks + decorations onto the app (identical effect to a hand-written
 * `definePlugin({ name, register })`).
 */
import { describe, it, expect, vi } from 'vitest'

import { plugin } from '../../packages/theo/src/server/define/index.js'
import type { HookName, TheoApp } from '../../packages/theo/src/server/plugin-types.js'

function mockApp(): TheoApp & {
  hooks: Array<[HookName, unknown]>
  decorations: Array<[string, unknown]>
} {
  const hooks: Array<[HookName, unknown]> = []
  const decorations: Array<[string, unknown]> = []
  return {
    hooks,
    decorations,
    addHook: (name, fn) => hooks.push([name, fn]),
    decorateRequest: (key, value) => decorations.push([key, value]),
  }
}

describe('plugin() builder', () => {
  it('synthesizes a TheoPlugin that wires every hook + decoration in order', async () => {
    const onReq = vi.fn()
    const onRes = vi.fn()

    const p = plugin('request-id')
      .onRequest(onReq)
      .onResponse(onRes)
      .decorateRequest('requestId', 'seed')
      .build()

    expect(p.name).toBe('request-id')

    const app = mockApp()
    await p.register(app)

    expect(app.hooks).toEqual([
      ['onRequest', onReq],
      ['onResponse', onRes],
    ])
    expect(app.decorations).toEqual([['requestId', 'seed']])
  })

  it('supports repeated hooks of the same kind', async () => {
    const a = vi.fn()
    const b = vi.fn()
    const p = plugin('multi').onRequest(a).onRequest(b).build()

    const app = mockApp()
    await p.register(app)
    expect(app.hooks).toEqual([
      ['onRequest', a],
      ['onRequest', b],
    ])
  })

  it('an empty plugin() builds a valid no-op register', async () => {
    const p = plugin('noop').build()
    const app = mockApp()
    await p.register(app)
    expect(app.hooks).toEqual([])
    expect(app.decorations).toEqual([])
  })
})
