import { describe, it, expect } from 'vitest'

import { assertNodeVersion, compareSemver, MIN_NODE_VERSION } from '../../src/preflight-node.js'

describe('compareSemver', () => {
  it('should return 0 for identical versions', () => {
    expect(compareSemver('22.12.0', '22.12.0')).toBe(0)
  })

  it('should return negative when a < b (major)', () => {
    expect(compareSemver('20.0.0', '22.0.0')).toBeLessThan(0)
  })

  it('should return positive when a > b (major)', () => {
    expect(compareSemver('24.0.0', '22.0.0')).toBeGreaterThan(0)
  })

  it('should compare minor versions correctly', () => {
    expect(compareSemver('22.10.0', '22.12.0')).toBeLessThan(0)
    expect(compareSemver('22.14.0', '22.12.0')).toBeGreaterThan(0)
  })

  it('should compare patch versions correctly', () => {
    expect(compareSemver('22.12.0', '22.12.5')).toBeLessThan(0)
    expect(compareSemver('22.12.9', '22.12.5')).toBeGreaterThan(0)
  })

  it('should strip leading v prefix', () => {
    expect(compareSemver('v22.12.0', '22.12.0')).toBe(0)
    expect(compareSemver('22.12.0', 'v22.12.0')).toBe(0)
    expect(compareSemver('v22.12.0', 'v22.12.0')).toBe(0)
  })

  it('should strip pre-release suffixes and compare base version', () => {
    expect(compareSemver('22.12.0-rc.1', '22.12.0')).toBe(0)
    expect(compareSemver('v23.0.0-nightly.20260101', '22.12.0')).toBeGreaterThan(0)
  })
})

describe('assertNodeVersion', () => {
  it('should not throw when current version meets minimum', () => {
    expect(() => assertNodeVersion('v22.12.0')).not.toThrow()
  })

  it('should not throw when current version exceeds minimum', () => {
    expect(() => assertNodeVersion('v24.0.0')).not.toThrow()
  })

  it('should throw when current version is below minimum', () => {
    expect(() => assertNodeVersion('v18.19.0')).toThrow(/requires Node/)
  })

  it('should include detected version in error message', () => {
    expect(() => assertNodeVersion('v18.19.0')).toThrow('18.19.0')
  })

  it('should include the minimum version in error message', () => {
    expect(() => assertNodeVersion('v18.0.0')).toThrow(MIN_NODE_VERSION)
  })

  it('should suggest nvm install in error message', () => {
    expect(() => assertNodeVersion('v18.0.0')).toThrow('nvm install')
  })

  it('should accept a custom minimum version', () => {
    expect(() => assertNodeVersion('v20.0.0', '20.0.0')).not.toThrow()
    expect(() => assertNodeVersion('v18.0.0', '20.0.0')).toThrow(/requires Node 20.0.0/)
  })
})
