import { describe, it, expect } from 'vitest'
import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'

describe('renderCloudflareWorkerEntry — template (T2.1)', () => {
  it('imports from theokit/adapters/web-shim', () => {
    const out = renderCloudflareWorkerEntry()
    expect(out).toContain("from 'theokit/adapters/web-shim'")
  })

  it('imports the execute pipeline from the narrow server subpaths', () => {
    // Was `from 'theokit/server'`. That umbrella is deprecated — the package prints so on import —
    // and it is what made the first real `wrangler deploy` fail: it pulls `@swc/core`'s `.node`
    // native addon, which workerd cannot load at any bundler setting (B-263). What this test
    // protects is unchanged: the worker reaches the execute pipeline.
    const out = renderCloudflareWorkerEntry()

    expect(out).toContain('matchRoute')
    expect(out).toContain('executeRoute')
    expect(out).toContain("from 'theokit/server/scan'")
    expect(out).toContain("from 'theokit/server/http'")
    expect(out).not.toMatch(/from 'theokit\/server'/)
  })

  it('does not claim scanServerRoutes, which the worker stopped calling', () => {
    // The assertion this replaces was `expect(out).toContain('scanServerRoutes')`, and it passed by
    // matching a COMMENT: the emitter says "`scanServerRoutes` on the server directory — a
    // readdirSync, in a runtime with no filesystem" precisely to record that the worker no longer
    // calls it. A worker that genuinely called it would be broken, so the old assertion could not
    // fail for the right reason. This pins the real state instead.
    const out = renderCloudflareWorkerEntry()
    const withoutComments = out.replace(/\/\/[^\n]*/g, '')

    expect(withoutComments).not.toContain('scanServerRoutes')
  })

  it('does NOT contain inline shim definitions (writeHead/setHeader inline)', () => {
    const out = renderCloudflareWorkerEntry()
    // The old approach had an inline `req = { method, url, headers, ... }`
    // plain-object shim. We want createWebShim instead.
    expect(out).not.toMatch(/socket: \{ remoteAddress/)
    expect(out).not.toMatch(/_headers: \{\}/)
  })

  it('resolves routes without scanning, at cold start or ever (#369)', () => {
    // This asserted a cold-start CACHE, which was the best available answer while
    // the worker scanned a directory: cache the scan so it happens once instead of
    // per request. The scan cannot happen at all on Workers — there is no
    // filesystem — so the routes are baked at build time and there is nothing left
    // to cache. The property that survives is the one the cache was approximating.
    const out = renderCloudflareWorkerEntry({
      routes: [{ filePath: 'server/routes/hello.ts', routePath: '/api/hello', methods: ['GET'] }],
    })

    expect(out).not.toMatch(/scanServerRoutes\(/u)
    expect(out).toMatch(/^const routes = \[$/mu)
  })

  it('emits requirements header block (EC-3)', () => {
    const out = renderCloudflareWorkerEntry()
    expect(out).toMatch(/nodejs_compat/)
    expect(out).toMatch(/dependencies/)
    expect(out).toMatch(/theokit/)
  })

  it('uses Web Standard fetch handler signature', () => {
    const out = renderCloudflareWorkerEntry()
    expect(out).toContain('fetch(request')
    expect(out).toContain('export default')
  })
})

describe('cloudflare wrangler.toml emission', () => {
  it('includes nodejs_compat flag (EC-3)', async () => {
    const { renderWranglerToml } = await import('../../packages/theo/src/adapters/cloudflare.js')
    const toml = renderWranglerToml()
    expect(toml).toContain('nodejs_compat')
  })
})
