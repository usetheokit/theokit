import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Minimal caret-OR-range membership check (no `semver` dep — parsimony rung 4).
 * The range is a fixed `^X.Y.Z || ^A.B.C` form; a version satisfies it when it
 * shares a major (or, for 0.x, a minor) with one of the caret bases. Sufficient
 * for the fixed lines this test pins (0.14.x / 0.18.x); not a general semver impl.
 */
function rangeAccepts(range: string, version: string): boolean {
  return range.split('||').some((part) => {
    const base = part.trim().replace(/^\^/, '')
    const [bMaj, bMin] = base.split('.')
    const [vMaj, vMin] = version.split('.')
    if (bMaj !== vMaj) return false
    // 0.x caret pins the MINOR (npm semantics: ^0.14.0 := >=0.14.0 <0.15.0).
    if (bMaj === '0') return bMin === vMin
    return true
  })
}

/**
 * V3-2 — the `@theokit/ui` optional peer must accept BOTH the legacy 0.14.x line
 * (existing consumers) AND the 0.18.x line (so theocode can adopt 0.18.x without
 * `npm install --force`). The old `^0.14.0` range caused an ERESOLVE against
 * @theokit/ui@0.18.1. This test pins the widened range as a permanent regression
 * guard — a future narrowing back to `^0.14.0` (re-breaking 0.18.x) fails here.
 */
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const theoPkg = JSON.parse(
  readFileSync(resolve(__dirname, '../../packages/theo/package.json'), 'utf-8'),
) as { peerDependencies?: Record<string, string> }

describe('@theokit/ui peer range (V3-2)', () => {
  const range = theoPkg.peerDependencies?.['@theokit/ui']

  it('test_ui_peer_is_declared', () => {
    expect(range, '@theokit/ui must remain an optional peer of theokit').toBeTruthy()
  })

  it('test_ui_peer_accepts_0_18', () => {
    // 0.18.1 was the ERESOLVE case under the old `^0.14.0` range.
    expect(rangeAccepts(range!, '0.18.1')).toBe(true)
    expect(rangeAccepts(range!, '0.18.0')).toBe(true)
  })

  it('test_ui_peer_accepts_0_19', () => {
    // The actual @theokit/ui V3-2 release shipped as 0.19.0 (its [Unreleased] also
    // carried Added entries → minor bump). The peer MUST cover the published line.
    expect(rangeAccepts(range!, '0.19.0')).toBe(true)
    // Still excludes the next unvalidated 0.x line — explicit OR, not an open range.
    expect(rangeAccepts(range!, '0.20.0')).toBe(false)
  })

  it('test_ui_peer_still_accepts_0_14', () => {
    // No regression for existing 0.14.x consumers.
    expect(rangeAccepts(range!, '0.14.4')).toBe(true)
    expect(rangeAccepts(range!, '0.14.0')).toBe(true)
  })
})
