import picomatch from 'picomatch'
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

describe('picomatch.scan with an unclosed bracket run', () => {
  // CodeQL js/polynomial-redos: `removeBackslashes` used a regular expression that rescans to the end
  // from every `[` that never closes. 4.0.7 takes about 6 s here; the vendored copy is linear.
  it('unescapes a long pattern in linear time', () => {
    const started = performance.now()
    picomatch.scan(`*${'['.repeat(60_000)}`, { unescape: true })
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  it('answers what 4.0.7 answers: escapes removed from the base, a bracket kept whole', () => {
    const scanned = picomatch.scan('a/\\*b/[\\]x]', { unescape: true })
    expect(scanned.base).toBe('a/*b')
    expect(scanned.glob).toBe('[\\]x]')
  })
})
