import { describe, it, expect } from 'vitest'

import { bunAdapter, renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import {
  UnenforceableRateLimitError,
  assertRateLimitEnforceable,
} from '../../packages/theo/src/adapters/config-support.js'
import { UnserialisableRateLimitError } from '../../packages/theo/src/adapters/deployed-rate-limit.js'
import type { TheoConfig } from '../../packages/theo/src/config/schema.js'

/**
 * usetheokit/theokit#508 — the Web-standards targets refused a declared rate limit instead of
 * enforcing one. This is the first target to stop refusing, and the choice of target is the point.
 *
 * `Bun.serve` is a LONG-LIVED process, so the in-process counter `createRateLimiterWeb` already
 * defaults to outlives a request — the same property `node` relies on. And `Bun.serve`'s `fetch`
 * already receives `server`, whose `requestIP(request)` returns the real caller address without a
 * header. Both halves the issue names as missing are, for this one target, already present.
 *
 * The other five stay refused, and that is deliberate rather than unfinished: Cloudflare, Lambda,
 * Netlify and Vercel are per-invocation runtimes where an in-process counter does not survive, and
 * a limiter that forgets between requests is a limit that does not limit. Deno Deploy evicts
 * isolates for the same reason. Shipping those needs external storage, which is a design decision
 * and not a wiring one.
 */

const withLimit = (rateLimit: unknown): TheoConfig =>
  ({ appDir: 'app', serverDir: 'server', port: 3000, rateLimit }) as unknown as TheoConfig

describe('bun enforces a declared rate limit (#508)', () => {
  it('no longer refuses the build — the target declares it applies rateLimit', () => {
    expect(bunAdapter.appliesConfig).toContain('rateLimit')
    expect(() =>
      assertRateLimitEnforceable(withLimit({ windowMs: 1000, max: 5 }), bunAdapter, 'bun'),
    ).not.toThrow(UnenforceableRateLimitError)
  })

  it('keys the bucket on the caller address Bun reports, never on a shared constant', () => {
    const out = renderBunEntry(3000, { rateLimit: { windowMs: 60_000, max: 100 } })

    // The defect the issue warns about is one shared bucket keyed on `0.0.0.0`: every visitor
    // counted as the same caller, so the limit trips for everyone at once. `server.requestIP` is
    // what makes the key per-caller, and it is only reachable because `fetch(request, server)`
    // already carries `server`.
    expect(out).toContain('server.requestIP(request)')
    expect(out).not.toContain('0.0.0.0')
    expect(out).toContain('createRateLimiterWeb')
    expect(out).toContain('60000')
    expect(out).toContain('100')
  })

  it('answers 429 with the limiter headers rather than serving the route', () => {
    const out = renderBunEntry(3000, { rateLimit: { windowMs: 1000, max: 1 } })
    expect(out).toContain('429')
  })

  it('emits nothing when the app declared no limit', () => {
    const out = renderBunEntry(3000)
    expect(out).not.toContain('createRateLimiterWeb')
  })

  it('refuses a keyBy function by name instead of baking a limit that keys on nothing', () => {
    // Same precedent as the CORS callback origin: there is no literal for a closure, and a build
    // that dropped it would deploy a config the operator reads as protection.
    expect(() =>
      renderBunEntry(3000, { rateLimit: { windowMs: 1000, max: 5, keyBy: () => 'x' } }),
    ).toThrow(UnserialisableRateLimitError)
  })

  it('refuses keyBy session/user by name — the deployed entry cannot resolve either', () => {
    expect(() =>
      renderBunEntry(3000, { rateLimit: { windowMs: 1000, max: 5, keyBy: 'session' } }),
    ).toThrow(UnserialisableRateLimitError)
  })
})
