import { describe, it, expect } from 'vitest'
import {
  vercelAdapter,
  renderVercelFunctionEntry,
  renderVercelConfigJson,
  renderVercelVcConfigJson,
} from '../../packages/theo/src/adapters/vercel.js'

describe('vercel adapter — shape', () => {
  it('exposes the DeployAdapter contract', () => {
    expect(vercelAdapter.name).toBe('vercel')
    expect(typeof vercelAdapter.build).toBe('function')
  })
})

describe('renderVercelFunctionEntry — template (T2.2)', () => {
  it('imports from theokit/adapters/web-shim', () => {
    const out = renderVercelFunctionEntry()
    expect(out).toContain("from 'theokit/adapters/web-shim'")
  })

  it('imports the execute pipeline by its public specifier, never an internal path', () => {
    // The original assertion spelled that specifier as the `theokit/server` umbrella. B-316 replaced
    // it with narrow subpaths: the umbrella re-exports the whole server half, and `@swc/core`'s
    // native `.node` addon is down that graph — wrangler refuses to bundle it and vite refuses to
    // parse it, so this target's function could not be bundled at all. The INTENT, stated in the
    // original name, was "not an internal theo-server path"; a subpath satisfies it and the umbrella
    // is no longer the only public spelling.
    const out = renderVercelFunctionEntry()

    expect(out).toContain("from 'theokit/server/scan'")
    expect(out).toContain("from 'theokit/server/http'")
    expect(out).not.toContain("'./theo-server/")
  })

  it('does not import the deprecated umbrella', () => {
    // COUNTERPROOF for the case above: asserting the subpaths does not by itself establish that the
    // umbrella left. A build emitting both would satisfy every line up there and still drag the
    // addon. `tests/unit/no-deployed-entry-imports-the-server-umbrella.test.ts` sweeps all six
    // adapters for this; the case here is the per-target guard beside the positive assertion.
    expect(renderVercelFunctionEntry()).not.toContain("from 'theokit/server'")
  })

  it('exports a default handler function', () => {
    const out = renderVercelFunctionEntry()
    expect(out).toContain('export default')
  })

  it('caches routes at cold start', () => {
    const out = renderVercelFunctionEntry()
    expect(out).toMatch(/routesCache|let.+routes/)
  })

  it('does NOT contain inline string-template shim definitions', () => {
    const out = renderVercelFunctionEntry()
    expect(out).not.toMatch(/socket: \{ remoteAddress/)
    expect(out).not.toMatch(/_headers: \{\}/)
  })
})

describe('renderVercelConfigJson — routing rules', () => {
  it('preserves /api/* → function and filesystem fallback', () => {
    const cfg = renderVercelConfigJson()
    expect(cfg.version).toBe(3)
    expect(cfg.routes).toEqual(
      expect.arrayContaining([expect.objectContaining({ src: '/api/(.*)' })]),
    )
  })
})

describe('renderVercelVcConfigJson — function metadata', () => {
  it('emits nodejs runtime + handler entry', () => {
    const vc = renderVercelVcConfigJson()
    expect(vc.runtime).toMatch(/nodejs/)
    expect(vc.handler).toBe('index.mjs')
  })
})
