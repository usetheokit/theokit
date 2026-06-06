/**
 * RED tests for classifyCsrfReadinessError — pure helper that maps
 * fetch failures into actionable error states for the devtools CSRF
 * Readiness tab.
 *
 * Before this helper landed, the tab showed a generic "Failed to fetch"
 * + one-size-fits-all "Wire csrfReadinessStore" hint regardless of the
 * actual cause (server down, CORS, missing endpoint, 5xx crash). That
 * gave false positives that misled debugging.
 */
import { describe, expect, it } from 'vitest'

import {
  classifyCsrfReadinessError,
  type CsrfReadinessErrorKind,
} from '../../packages/theo/src/devtools/format/csrf-readiness-classify.js'

describe('classifyCsrfReadinessError', () => {
  it('should classify HTTP 404 as store-not-wired (the canonical case)', () => {
    const out = classifyCsrfReadinessError({ kind: 'http', status: 404 })
    expect(out.kind satisfies CsrfReadinessErrorKind).toBe('store-not-wired')
    expect(out.summary).toMatch(/404/)
    expect(out.hint).toMatch(/csrfReadinessStore/)
  })

  it('should classify HTTP 500/502/503 as server-crash (distinct hint)', () => {
    for (const status of [500, 502, 503]) {
      const out = classifyCsrfReadinessError({ kind: 'http', status })
      expect(out.kind).toBe('server-crash')
      expect(out.summary).toMatch(new RegExp(String(status)))
      expect(out.hint).toMatch(/check dev server logs/i)
    }
  })

  it('should classify HTTP 401/403 as unauthorized (rare, distinct hint)', () => {
    for (const status of [401, 403]) {
      const out = classifyCsrfReadinessError({ kind: 'http', status })
      expect(out.kind).toBe('unauthorized')
      expect(out.summary).toMatch(new RegExp(String(status)))
      expect(out.hint).toMatch(/auth|requireAuth|session/i)
    }
  })

  it('should classify other 4xx as unexpected-status', () => {
    const out = classifyCsrfReadinessError({ kind: 'http', status: 418 })
    expect(out.kind).toBe('unexpected-status')
    expect(out.summary).toMatch(/418/)
  })

  it('should classify TypeError "Failed to fetch" as server-unreachable', () => {
    const out = classifyCsrfReadinessError({
      kind: 'thrown',
      error: new TypeError('Failed to fetch'),
    })
    expect(out.kind).toBe('server-unreachable')
    expect(out.summary).toMatch(/dev server unreachable/i)
    expect(out.hint).toMatch(/restart|dev server|theokit dev/i)
  })

  it('should classify TypeError "NetworkError" as server-unreachable', () => {
    const out = classifyCsrfReadinessError({
      kind: 'thrown',
      error: new TypeError('NetworkError when attempting to fetch resource.'),
    })
    expect(out.kind).toBe('server-unreachable')
  })

  it('should classify AbortError as aborted (silent — user navigated away)', () => {
    const err = new Error('The user aborted a request.')
    err.name = 'AbortError'
    const out = classifyCsrfReadinessError({ kind: 'thrown', error: err })
    expect(out.kind).toBe('aborted')
  })

  it('should classify unknown thrown values as unknown-error (fallback)', () => {
    const out = classifyCsrfReadinessError({
      kind: 'thrown',
      error: new Error('Some unexpected failure'),
    })
    expect(out.kind).toBe('unknown-error')
    expect(out.summary).toMatch(/Some unexpected failure/)
  })

  it('should classify non-Error thrown values gracefully', () => {
    const out = classifyCsrfReadinessError({ kind: 'thrown', error: 'plain string' })
    expect(out.kind).toBe('unknown-error')
    expect(out.summary).toMatch(/plain string|unknown/i)
  })
})
