/**
 * M31 Phase 3 — `config()` fluent builder (hybrid grammar: setters + `.set()` escape). `.build()`
 * emits the same `Partial<TheoConfig>` a hand-written `defineConfig({...})` would (identity).
 */
import { describe, it, expect } from 'vitest'

import { config } from '../../packages/theo/src/index.js'
import { defineConfig } from '../../packages/theo/src/config/define-config.js'

describe('config() builder — hybrid grammar', () => {
  it('setters produce the same object as defineConfig({...})', () => {
    const built = config().serverDir('core').agentsDir('core/agents').appDir('apps/web').build()
    const legacy = defineConfig({
      serverDir: 'core',
      agentsDir: 'core/agents',
      appDir: 'apps/web',
    })
    expect(built).toEqual(legacy)
  })

  it('.set() merges long-tail fields not covered by a dedicated setter', () => {
    const built = config()
      .port(4000)
      .ssr(true)
      .set({ security: { csrf: 'strict' } })
      .build()
    expect(built.port).toBe(4000)
    expect(built.ssr).toBe(true)
    expect(built.security).toEqual({ csrf: 'strict' })
  })

  it('later setters override earlier ones (last-write-wins merge)', () => {
    const built = config().serverDir('server').serverDir('core').build()
    expect(built.serverDir).toBe('core')
  })

  it('an empty config() builds {}', () => {
    expect(config().build()).toEqual({})
  })
})
