import { describe, expect, it } from 'vitest'

import {
  BindRefusedError,
  GuardConfigError,
  isLoopback,
  parsePort,
  resolveBindAddress,
} from '../../src/guards/index.js'

const opts = { hostVariable: 'APP_HOST', consentVariable: 'APP_PUBLIC' }

describe('isLoopback', () => {
  it.each([
    ['127.0.0.1', true],
    ['127.5.6.7', true],
    ['localhost', true],
    ['::1', true],
    ['LOCALHOST', false],
    ['[::1]', false],
    ['::ffff:127.0.0.1', false],
    ['127.1', false],
    ['0.0.0.0', false],
  ])('%s -> %s', (host, expected) => {
    expect(isLoopback(host)).toBe(expected)
  })
})

describe('resolveBindAddress', () => {
  it('defaults to loopback, ignoring HOST', () => {
    expect(resolveBindAddress({}, opts)).toBe('127.0.0.1')
    expect(resolveBindAddress({ HOST: '0.0.0.0' }, opts)).toBe('127.0.0.1')
  })
  it('refuses a public host without consent, naming address and variable', () => {
    try {
      resolveBindAddress({ APP_HOST: '0.0.0.0' }, opts)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(BindRefusedError)
      expect((e as BindRefusedError).address).toBe('0.0.0.0')
      expect((e as Error).message).toContain('APP_PUBLIC')
    }
  })
  it('returns it with consent', () => {
    expect(resolveBindAddress({ APP_HOST: '0.0.0.0', APP_PUBLIC: 'yes' }, opts)).toBe('0.0.0.0')
    expect(
      resolveBindAddress(
        { APP_HOST: '0.0.0.0', APP_PUBLIC: 'ok' },
        { ...opts, consentValue: 'ok' },
      ),
    ).toBe('0.0.0.0')
  })
})

describe('parsePort', () => {
  it('accepts the range ends', () => {
    expect(parsePort({ P: '0' }, 'P')).toBe(0)
    expect(parsePort({ P: '65535' }, 'P')).toBe(65535)
  })
  it.each([' 8080', '65536', 'abc'])('refuses %s naming the variable', (v) => {
    expect(() => parsePort({ P: v }, 'P')).toThrow(GuardConfigError)
    expect(() => parsePort({ P: v }, 'P')).toThrow(/P must/)
  })
})
