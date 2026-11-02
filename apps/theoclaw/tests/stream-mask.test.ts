import { describe, expect, it } from 'vitest'

import { maskSecrets } from '../src/channels/channel-loop.js'
import { createStreamMask } from '../src/channels/stream-mask.js'

/** A 40-character configured value, and a shorter one that is its start. */
const SECRET = 'sk-live-0123456789abcdefghijABCDEFGHIJ-z'
const SHORT = 'sk-live-01'

function occurrences(text: string, value: string): number {
  return text.split(value).length - 1
}

describe('createStreamMask', () => {
  it('a value split at every point is masked', () => {
    expect(SECRET).toHaveLength(40)
    for (let split = 1; split < SECRET.length; split += 1) {
      const mask = createStreamMask([SECRET])
      const out = mask.push(`before ${SECRET.slice(0, split)}`) + mask.push(`${SECRET.slice(split)} after`) + mask.flush()

      expect(occurrences(out, SECRET), `split at ${split}`).toBe(0)
      expect(out).toBe('before [redacted] after')
    }
  })

  it('nothing held is lost at flush', () => {
    const whole = `a ${SECRET.slice(0, 12)} b ${SECRET} c sk-live`
    const mask = createStreamMask([SECRET, SHORT])
    const out = [...whole].map((character) => mask.push(character)).join('') + mask.flush()

    expect(out).toBe(maskSecrets(whole, [SECRET, SHORT]))
  })

  it('holds back only what could still grow into a value', () => {
    const mask = createStreamMask([SECRET])

    expect(mask.push('plain text sk-li')).toBe('plain text ')
    expect(mask.push('ght')).toBe('sk-light')
    expect(mask.flush()).toBe('')
  })

  it('a short value that starts a longer one is not released while the longer may still arrive', () => {
    const mask = createStreamMask([SECRET, SHORT])
    const out = mask.push(`x ${SHORT}`) + mask.push(SECRET.slice(SHORT.length)) + mask.flush()

    expect(out).toBe('x [redacted]')
  })

  it('passes text through untouched with no configured value', () => {
    const mask = createStreamMask(['', ''])

    expect(mask.push('anything sk-live')).toBe('anything sk-live')
    expect(mask.flush()).toBe('')
  })
})
