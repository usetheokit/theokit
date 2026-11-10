import { describe, expect, it } from 'vitest'

import { getDefaults } from '../../src/prompts.js'

describe('--bare defaults', () => {
  it('turn Tailwind off, so applyOptions cannot re-add @tailwindcss/vite after the bare transform', () => {
    expect(getDefaults('x', true).tailwind).toBe(false)
    expect(getDefaults('x').tailwind).toBe(true)
  })
})
