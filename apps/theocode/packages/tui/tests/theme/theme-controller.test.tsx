/** The toolkit's `createThemeController` (object signature), tested directly as TheoCode uses it. */
import { describe, expect, it, vi } from 'vitest'

import { createThemeController } from '@theokit/tui'

import type { TheoThemeProp } from '@theokit/tui'

describe('createThemeController', () => {
  it.each<[string, TheoThemeProp]>([
    ['a built-in name', 'light'],
    ['an override', { accent: '#123456' } as TheoThemeProp],
    [
      'a {base, override} object',
      { base: 'dark', override: { accent: '#123456' } } as TheoThemeProp,
    ],
  ])('holds %s', (_n, initial) => {
    expect(createThemeController({ initial }).get()).toBe(initial)
  })

  it('notifies listeners on set, and not for the same object', () => {
    const first = { base: 'dark', override: {} } as TheoThemeProp
    const c = createThemeController({ initial: first })
    const listener = vi.fn()
    c.subscribe(listener)
    c.set(first)
    expect(listener).not.toHaveBeenCalled()
    const next = { base: 'light', override: {} } as TheoThemeProp
    c.set(next)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(c.get()).toBe(next)
  })

  it('stops notifying after unsubscribe', () => {
    const c = createThemeController({ initial: 'dark' })
    const listener = vi.fn()
    const off = c.subscribe(listener)
    off()
    c.set('light')
    expect(listener).not.toHaveBeenCalled()
  })

  it('rejects an invalid theme prop', () => {
    expect(() => createThemeController({ initial: 'nope' as TheoThemeProp })).toThrow(/unknown theme "nope"/)
    const c = createThemeController({ initial: 'dark' })
    expect(() => c.set('nope' as TheoThemeProp)).toThrow(/unknown theme "nope"/)
    expect(c.get()).toBe('dark')
  })
})
