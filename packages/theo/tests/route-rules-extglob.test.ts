import { describe, expect, it } from 'vitest'

import { compileRouteRules, resolveRouteRule } from '../src/cache/route-rules.js'

/**
 * GHSA-fc5q-39xc-vjpf: a repeated single-branch extglob such as `+(*a)` made picomatch <= 4.0.7
 * build a regular expression that backtracks exponentially. Against these 29-character paths the
 * unpatched matcher took 68 s and 102 s; the vendored copy in `vendor/picomatch` answers in
 * milliseconds. The bound below is far above the patched time and far below the unpatched one.
 */
const HOSTILE = [
  ['/+(*a)', `/${'a'.repeat(28)}b`],
  ['/*(*a)', `/${'a'.repeat(28)}b`],
] as const

describe('compileRouteRules with a repeated single-branch extglob', () => {
  it.each(HOSTILE)('matches %s against a non-matching path in linear time', (pattern, path) => {
    const compiled = compileRouteRules({ [pattern]: { maxAge: 60 } })
    const started = performance.now()
    const rule = resolveRouteRule(path, compiled)
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(rule).toBeUndefined()
  })

  it('still matches what the pattern describes', () => {
    const compiled = compileRouteRules({ '/+(*a)': { maxAge: 60 } })
    expect(resolveRouteRule('/banana', compiled)).toEqual({ maxAge: 60 })
    expect(resolveRouteRule('/bananas', compiled)).toBeUndefined()
  })
})
