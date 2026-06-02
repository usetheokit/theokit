/**
 * RED test for devtools default theme: must be 'dark' (was 'system').
 *
 * Decision rationale: most consumers run the dogfood/dev surfaces in dark
 * terminals/themes already, and the violet-forge tokens were tuned against
 * the dark palette first. Defaulting to 'dark' gives a consistent visual
 * across initial boot until the user explicitly opts into light/system.
 */
import { describe, expect, it } from 'vitest'

import { initialState } from '../../packages/theo/src/devtools/shared.js'

describe('devtools initial theme', () => {
  it('should default to "dark" (not "system" or "light")', () => {
    expect(initialState.theme).toBe('dark')
  })
})
