import { describe, it, expect } from 'vitest'
import { resolveAdapter } from '../../src/server/observability/adapter-registry.js'

describe('T30.4 — Adapter registry', () => {
  it('resolves theo-cloud when THEO_CLOUD_INGEST_URL is set', () => {
    const adapter = resolveAdapter({
      env: { THEO_CLOUD_INGEST_URL: 'https://ingest.test', THEO_CLOUD_API_KEY: 'tck_x' },
    })
    expect(adapter.name).toBe('theo-cloud')
  })

  it('resolves console when NODE_ENV=development', () => {
    const adapter = resolveAdapter({ env: { NODE_ENV: 'development' } })
    expect(adapter.name).toBe('console')
  })

  it('resolves noop as fallback', () => {
    const adapter = resolveAdapter({ env: {} })
    expect(adapter.name).toBe('noop')
  })

  it('config provider takes precedence over env detection', () => {
    const custom = {
      name: 'custom',
      startSpan: () => ({ setAttribute() {}, setStatus() {}, end() {} }),
      counter() {}, histogram() {}, log() {},
      flush: async () => {}, shutdown: async () => {},
    }
    const adapter = resolveAdapter({
      env: { NODE_ENV: 'development' },
      config: { provider: custom },
    })
    expect(adapter.name).toBe('custom')
  })

  it('EC-4: config provider overrides THEO_CLOUD env var', () => {
    const custom = {
      name: 'custom-override',
      startSpan: () => ({ setAttribute() {}, setStatus() {}, end() {} }),
      counter() {}, histogram() {}, log() {},
      flush: async () => {}, shutdown: async () => {},
    }
    const adapter = resolveAdapter({
      env: { THEO_CLOUD_INGEST_URL: 'https://ingest.test', THEO_CLOUD_API_KEY: 'tck_x' },
      config: { provider: custom },
    })
    expect(adapter.name).toBe('custom-override')
  })

  it('THEO_CLOUD env without API key falls through to dev/noop', () => {
    const adapter = resolveAdapter({
      env: { THEO_CLOUD_INGEST_URL: 'https://ingest.test', NODE_ENV: 'development' },
    })
    expect(adapter.name).toBe('console') // No API key → skip theo-cloud → fall to console
  })
})
