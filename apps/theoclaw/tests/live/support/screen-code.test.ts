import { describe, expect, it } from 'vitest'
import { namesScreenCode } from './screen-code.js'

describe('namesScreenCode', () => {
  it('accepts the code joined or spaced', () => {
    expect(namesScreenCode('The code is JG66E7.', 'JG66E7')).toBe(true)
    expect(namesScreenCode('The code is J G 6 6 E 7.', 'JG66E7')).toBe(true)
  })
  it('rejects a wrong, short, reordered or longer code', () => {
    expect(namesScreenCode('The code is J G 6 6 E 8.', 'JG66E7')).toBe(false)
    expect(namesScreenCode('The code is J G 6 6 E', 'JG66E7')).toBe(false)
    expect(namesScreenCode('The code is 7 E 6 6 G J', 'JG66E7')).toBe(false)
    expect(namesScreenCode('The code is JG66E7X', 'JG66E7')).toBe(false)
  })
})
