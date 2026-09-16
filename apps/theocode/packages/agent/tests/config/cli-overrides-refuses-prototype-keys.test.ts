/**
 * `-c` cannot reach `Object.prototype`, proved rather than read.
 *
 * ## Why this exists
 *
 * CodeQL raised `js/prototype-polluting-assignment` twice against `cli-overrides.ts` when this
 * package joined the monorepo on 2026-09-16 — the first time that code had ever been scanned. Both
 * point at real assignments from a user-supplied path: `-c a.b=1` splits on `.` and walks, creating
 * objects as it goes.
 *
 * Reading the module answers the alert: `requireUsablePath` refuses `__proto__`, `constructor` and
 * `prototype`, and line 57 calls it before line 58 descends. The scanner cannot see a validation
 * that happens across a function boundary, so the alert is a false positive.
 *
 * **That reading is not what makes it safe.** `cliOverridesLayer` had no test of any kind, and this
 * session spent a day on exactly that gap one layer up: `applySubagentMemory` shipped present,
 * correct-looking and broken for a full release because nothing called it. A guard nobody exercises
 * is a guard nobody knows about, and dismissing a security alert on the strength of having read the
 * code is how a real one gets dismissed next time.
 *
 * So the alert is answered with evidence: the attack is attempted here, and the assertion is that
 * `Object.prototype` is untouched afterwards — not merely that a throw happened, because a throw
 * AFTER the pollution would still throw.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { cliOverridesLayer } from '../../src/config/cli-overrides.js'

/** Every key any of these tests could leak, cleaned whether the test passed or failed. */
const CANARIES = ['polluted', 'alsoPolluted', 'viaConstructor'] as const

afterEach(() => {
  for (const key of CANARIES) {
    delete (Object.prototype as Record<string, unknown>)[key]
  }
})

const reachedPrototype = (key: string): boolean =>
  (({}) as Record<string, unknown>)[key] !== undefined

describe('a config override cannot reach Object.prototype', () => {
  it.each([
    ['__proto__.polluted=1', 'polluted'],
    ['constructor.prototype.viaConstructor=1', 'viaConstructor'],
    ['prototype.alsoPolluted=1', 'alsoPolluted'],
  ])('refuses %s, and leaves the prototype untouched', (pair, canary) => {
    expect(() => cliOverridesLayer([pair])).toThrow()

    // The half that actually matters. A throw raised AFTER the assignment would satisfy the line
    // above and leave every object in the process carrying the key.
    expect(reachedPrototype(canary), `${pair} reached Object.prototype`).toBe(false)
  })

  it('says which segment it refused, so the operator can fix the flag', () => {
    // The message is the difference between a usable refusal and a wall. It names the segment and
    // the reason — the schema's strict validation runs on the object, and a polluted prototype
    // would carry keys underneath it.
    expect(() => cliOverridesLayer(['__proto__.polluted=1'])).toThrow(/__proto__/)
  })

  it('still accepts an ordinary nested key, so the guard is not a blanket refusal', () => {
    // The control. A guard that refused everything would pass all three cases above while making
    // the flag useless, and nothing there would have noticed.
    expect(cliOverridesLayer(['a.b=1'])).toEqual({ a: { b: '1' } })
  })
})
