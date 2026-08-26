/**
 * The surface this package exists to carry, whole.
 *
 * Moving `@theokit/agents/pty` here (#460) is only safe if nothing is lost on the way: the point of
 * the move is the install cost, not the API. Six symbols went in and six must come out, which is
 * what the barrel test on the old subpath asserted before it was removed.
 */
import { describe, it, expect } from 'vitest'

import * as pty from '../../src/index.js'

describe('@theokit/agents-pty', () => {
  it('carries the whole @theokit/sdk-pty surface it re-exports', async () => {
    const upstream = await import('@theokit/sdk-pty')
    // Values only: a type-only export has no runtime key, and `PtyInteractiveBackendOptions` is one.
    for (const name of [
      'clampYield',
      'MaxSessionsError',
      'PtyInteractiveBackend',
      'YIELD_MAX_MS',
      'YIELD_MIN_MS',
    ]) {
      expect(pty, `${name} must reach a consumer of this package`).toHaveProperty(name)
      expect((pty as Record<string, unknown>)[name]).toBe(
        (upstream as Record<string, unknown>)[name],
      )
    }
  })

  it('re-exports rather than wrapping — the identity is the upstream one', async () => {
    const upstream = await import('@theokit/sdk-pty')
    // A wrapper would compare unequal here, and a wrapper is what the old entry's docblock refused.
    expect(pty.PtyInteractiveBackend).toBe(upstream.PtyInteractiveBackend)
  })
})
