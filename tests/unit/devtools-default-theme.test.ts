/**
 * Tests for devtools default theme being 'dark' end-to-end.
 *
 * Decision rationale: most consumers run the dogfood/dev surfaces in dark
 * terminals/themes already, and the violet-forge tokens were tuned against
 * the dark palette first. Defaulting to 'dark' gives a consistent visual
 * across initial boot until the user explicitly opts into light/system.
 *
 * The STORAGE_VERSION bump (1 -> 2) ensures consumers with persisted
 * `theme: 'system'` from prior runs do NOT override the new default on
 * upgrade — loadFromStorage() returns {} when the version key mismatches.
 */
import { describe, expect, it } from 'vitest'

import { STORAGE_VERSION, initialState } from '../../packages/theo/src/devtools/shared.js'

describe('devtools initial theme', () => {
  it('should default to "dark" (not "system" or "light")', () => {
    expect(initialState.theme).toBe('dark')
  })

  it('should bump STORAGE_VERSION to invalidate persisted "system" from prior runs', () => {
    // STORAGE_VERSION = 1 was the cohort that defaulted theme to 'system'.
    // The bump forces loadFromStorage() to return {} on first boot post-
    // upgrade, so the new dark default takes effect (not overridden by
    // localStorage spread in the Overlay reducer init).
    expect(STORAGE_VERSION).toBeGreaterThanOrEqual(2)
  })
})
