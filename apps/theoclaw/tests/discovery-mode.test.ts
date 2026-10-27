import { describe, expect, it } from 'vitest'

import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { parseDiscoveryMode, TheoClawDiscoveryError } from '../src/discovery/publisher.js'

function refusal(value: string): Error {
  try {
    parseDiscoveryMode({ THEOCLAW_MDNS: value })
  } catch (error) {
    return error as Error
  }
  throw new Error(`parseDiscoveryMode accepted THEOCLAW_MDNS=${value}`)
}

/** FR-004 (B-513): the three accepted states of THEOCLAW_MDNS, and the refusal of every other value. */
describe('parseDiscoveryMode', () => {
  it('THEOCLAW_MDNS unset, empty or on means announce', () => {
    expect(parseDiscoveryMode({})).toBe('on')
    expect(parseDiscoveryMode({ THEOCLAW_MDNS: '' })).toBe('on')
    expect(parseDiscoveryMode({ THEOCLAW_MDNS: '  ' })).toBe('on')
    expect(parseDiscoveryMode({ THEOCLAW_MDNS: 'on' })).toBe('on')
  })

  it('THEOCLAW_MDNS=off turns discovery off', () => {
    expect(parseDiscoveryMode({ THEOCLAW_MDNS: 'off' })).toBe('off')
    expect(parseDiscoveryMode({ THEOCLAW_MDNS: ' off ' })).toBe('off')
  })

  it('any other THEOCLAW_MDNS stops with TheoClawConfigError naming the variable and on/off, without the value', () => {
    for (const value of ['false', 'ON', '0', 'yes']) {
      const error = refusal(value)
      expect(error).toBeInstanceOf(TheoClawConfigError)
      expect((error as TheoClawConfigError).variable).toBe('THEOCLAW_MDNS')
      expect(error.message).toMatch(/THEOCLAW_MDNS/)
      expect(error.message).toMatch(/on or off/)
      expect(error.message).not.toContain(value)
    }
  })
})

describe('TheoClawDiscoveryError', () => {
  it('a discovery error carries the cause, its code and its route', () => {
    const cause = Object.assign(new Error('x'), { code: 'EACCES' })
    const error = new TheoClawDiscoveryError(cause, 'answer')
    expect(error.name).toBe('TheoClawDiscoveryError')
    expect(error.code).toBe('EACCES')
    expect(error.route).toBe('answer')
    expect(error.cause).toBe(cause)
    expect(error.message).toBe('LAN discovery failed: EACCES (answer)')

    expect(new TheoClawDiscoveryError(new Error('no code'), 'socket').code).toBe('UNKNOWN')
    expect(new TheoClawDiscoveryError('a string', 'publish').code).toBe('UNKNOWN')
    expect(new TheoClawDiscoveryError({ code: -13 }, 'socket').code).toBe('UNKNOWN')
    expect(new TheoClawDiscoveryError({ code: '' }, 'socket').code).toBe('UNKNOWN')
  })
})
