/**
 * RED tests for T2.1 helper — _internal/log-safe.ts
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 2 / T2.1.
 */
import { describe, expect, it } from 'vitest'

import { limitUntrustedHeaderValueForLogs } from '../../packages/theo/src/server/_internal/log-safe.js'

describe('limitUntrustedHeaderValueForLogs', () => {
  it('should pass short clean strings unchanged', () => {
    expect(limitUntrustedHeaderValueForLogs('example.com')).toBe('example.com')
  })

  it('should truncate strings beyond max length', () => {
    const long = 'x'.repeat(200)
    const out = limitUntrustedHeaderValueForLogs(long)
    expect(out.length).toBeLessThanOrEqual(101) // 100 + ellipsis
    expect(out.endsWith('…')).toBe(true)
  })

  it('should respect custom maxLen', () => {
    const out = limitUntrustedHeaderValueForLogs('abcdefghij', 5)
    expect(out).toBe('abcde…')
  })

  it('should escape control characters as \\xNN', () => {
    expect(limitUntrustedHeaderValueForLogs('a\x00b')).toBe('a\\x00b')
    expect(limitUntrustedHeaderValueForLogs('a\nb')).toBe('a\\x0Ab')
    expect(limitUntrustedHeaderValueForLogs('a\rb')).toBe('a\\x0Db')
    expect(limitUntrustedHeaderValueForLogs('a\x1Bb')).toBe('a\\x1Bb') // ANSI escape
  })

  it('should escape DEL (0x7F)', () => {
    expect(limitUntrustedHeaderValueForLogs('a\x7Fb')).toBe('a\\x7Fb')
  })

  it('should NOT escape regular printable characters', () => {
    expect(limitUntrustedHeaderValueForLogs('foo bar BAZ 123 !@#')).toBe('foo bar BAZ 123 !@#')
  })
})
