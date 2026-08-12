import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * `theokit`'s optional `@theokit/ui` peer must accept the WHOLE line the canonical template pins.
 *
 * ## The real defect this guard exists to catch
 *
 * V3-2 was born from an ERESOLVE: the peer was `^0.14.0` and the consumer adopted `@theokit/ui@0.18.1`.
 * npm is strict about optional-peer conflicts (pnpm is lenient, which is why the pnpm dogfood did not
 * catch it), so a freshly scaffolded `npx create-theokit` failed `npm install`.
 *
 * ## Why it was red, and what changed
 *
 * The first version froze LITERALS: `0.14.x`, `0.18.x`, `0.19.0`, `1.0.0`. Commit `f09fbbac`
 * (2026-07-16) narrowed the peer to `^1.1.0` and **deliberately dropped** the 0.x clauses — that line
 * was discontinued at the AI-exclusive pivot. The literal assertions then demanded compatibility with
 * a line the team removed on purpose, and the guard went red by default. A permanently red guard
 * protects nothing: it trains the team to ignore red.
 *
 * Moving the literals from `0.x` to `1.x` would only push the rot one step down the road. The
 * property the guard always meant to express is **coherence**: the peer's floor may not sit ABOVE the
 * floor the template pins, or a lockfile resolving the template's floor gives ERESOLVE on the first
 * install. That is what it checks now, and it needs no edit when the line legitimately advances.
 * Same pattern applied to the fixture guard in M67. Backlog B-M67-01, items 1-4.
 */

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const theoPkg = JSON.parse(
  readFileSync(resolve(__dirname, '../../packages/theo/package.json'), 'utf-8'),
) as { peerDependencies?: Record<string, string> }
const templateTmpl = readFileSync(
  resolve(__dirname, '../../packages/create-theokit/templates/default/package.json.tmpl'),
  'utf-8',
)

/** `^X.Y.Z` → `[X, Y, Z]`. Returns `undefined` for any other shape. */
function caretParts(pin: string): [number, number, number] | undefined {
  const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(pin.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

/**
 * npm's caret semantics, without pulling in `semver` (parsimony ladder, rung 4 — the check fits in a
 * lexicographic tuple comparison).
 *
 * `^X.Y.Z` with X > 0 is `>=X.Y.Z <(X+1).0.0`. For `^0.Y.Z` the caret pins the MINOR:
 * `>=0.Y.Z <0.(Y+1).0`. The previous version of this function approximated it as "shares a major",
 * which made `^1.1.0` "accept" `1.0.0` — green for the wrong reason, exactly what this guard exists
 * to prevent.
 */
function caretAccepts(pin: string, version: [number, number, number]): boolean {
  const base = caretParts(pin)
  if (base === undefined) return false
  const [bMaj, bMin, bPat] = base
  const [vMaj, vMin, vPat] = version
  if (bMaj !== vMaj) return false
  if (bMaj === 0 && bMin !== vMin) return false
  // Inside the caret window, the version must still be >= the floor.
  if (vMin !== bMin) return vMin > bMin
  return vPat >= bPat
}

/** A version satisfies a `^A || ^B` range when it satisfies at least one clause. */
function rangeAccepts(range: string, version: [number, number, number]): boolean {
  return range.split('||').some((part) => caretAccepts(part, version))
}

describe('@theokit/ui peer range (V3-2)', () => {
  const range = theoPkg.peerDependencies?.['@theokit/ui']
  const templatePin = /"@theokit\/ui":\s*"([^"]+)"/.exec(templateTmpl)?.[1]

  it('test_ui_peer_is_declared', () => {
    expect(range, '@theokit/ui must remain an optional peer of theokit').toBeTruthy()
  })

  it('test_the_default_template_pins_a_single_caret', () => {
    // If the template pinned an open range (`*`, `>=1`), the coherence assertion below would have no
    // floor to compare against — and the scaffold could resolve anything.
    expect(templatePin, 'the canonical template must declare @theokit/ui').toBeTruthy()
    expect(caretParts(templatePin!), `template pin is not a caret: ${templatePin}`).toBeTruthy()
  })

  it('test_ui_peer_accepts_the_whole_line_the_template_pins', () => {
    // The property that matters: a freshly scaffolded `npx create-theokit` must install — including
    // with a lockfile that resolves the FLOOR of the template's range, not just the day's `latest`.
    const floor = caretParts(templatePin!)!
    expect(
      rangeAccepts(range!, floor),
      `the peer "${range}" refuses ${floor.join('.')}, the floor the template pins ("${templatePin}") — ` +
        `a lockfile at that floor would break the install with ERESOLVE`,
    ).toBe(true)
  })

  it('test_the_next_major_is_not_accepted_implicitly', () => {
    // The range is a series of OR-joined carets, one per VALIDATED line (ADR 0018) — never an open
    // range. A new major enters by explicit decision, not by inheritance.
    const floor = caretParts(templatePin!)!
    expect(rangeAccepts(range!, [floor[0] + 1, 0, 0])).toBe(false)
  })

  it('test_caretAccepts_rejects_the_shapes_that_are_not_carets', () => {
    // Negative lens: the helper is the oracle of the tests above. If it accepted anything, they would
    // go green without proving a thing — which is how the previous approximation went unnoticed.
    for (const notACaret of ['1.1.0', '~1.1.0', '>=1.1.0', '*', '^1.1', '^1', '']) {
      expect(caretAccepts(notACaret, [1, 1, 0]), `should reject "${notACaret}"`).toBe(false)
    }
  })

  it('test_caretAccepts_honours_the_floor_within_the_window', () => {
    expect(caretAccepts('^1.1.0', [1, 0, 0])).toBe(false) // below the floor
    expect(caretAccepts('^1.1.0', [1, 1, 0])).toBe(true) // exactly the floor
    expect(caretAccepts('^1.1.0', [1, 3, 2])).toBe(true) // inside the window
    expect(caretAccepts('^1.1.0', [2, 0, 0])).toBe(false) // next major
    expect(caretAccepts('^0.14.0', [0, 14, 9])).toBe(true) // 0.x: the caret pins the minor
    expect(caretAccepts('^0.14.0', [0, 15, 0])).toBe(false)
  })
})
