import { describe, expect, it } from 'vitest'
import { credentialShape, describeCredentialDefect, type CredentialDefect } from './index.js'

const CASES: ReadonlyArray<readonly [CredentialDefect, string]> = [
  ['edge_whitespace', 'sk-abcdefgh12345\n'],
  ['inner_whitespace', 'sk-abcd efgh12345'],
  ['quote_or_backslash', '"sk-abcdefgh12345"'],
  ['control_character', 'sk-abcd\u0001efgh12345'],
  ['placeholder', 'changeme'],
  ['too_short', 'abc123'],
]

describe('credentialShape', () => {
  it('each defect is detected', () => {
    for (const [defect, value] of CASES) expect(credentialShape(value)).toBe(defect)
    expect(credentialShape('k9Xq2LmZ7vB4nR8tY1wC5dF3gH6jP0sA9uEoIxTz')).toBe('ok')
  })

  it('placeholder variants are detected case-insensitively', () => {
    for (const v of ['CHANGE-ME', 'your-api-key', 'xxxxxxxx', '<token>', '...', 'TODO', 'null'])
      expect(credentialShape(v, { minLength: 1 })).toBe('placeholder')
  })

  it('the description never contains the value', () => {
    for (const [defect, value] of CASES) {
      const text = describeCredentialDefect(defect)
      expect(text).not.toContain(value.trim())
      expect(text.length).toBeGreaterThan(0)
    }
  })

  it('minLength overrides the default of 8', () => {
    expect(credentialShape('abcdef')).toBe('too_short')
    expect(credentialShape('abcdef', { minLength: 4 })).toBe('ok')
    expect(credentialShape('abcdefgh', { minLength: 12 })).toBe('too_short')
    expect(describeCredentialDefect('too_short', 12)).toContain('12')
  })
})
