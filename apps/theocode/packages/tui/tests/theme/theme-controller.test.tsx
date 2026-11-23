/** The patched `createThemeController` (see patches/@theokit__tui@0.83.4.patch), tested directly. */
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
    expect(createThemeController(initial).get()).toBe(initial)
  })

  it('notifies listeners on set, and not for the same object', () => {
    const first = { base: 'dark', override: {} } as TheoThemeProp
    const c = createThemeController(first)
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
    const c = createThemeController('dark')
    const listener = vi.fn()
    const off = c.subscribe(listener)
    off()
    c.set('light')
    expect(listener).not.toHaveBeenCalled()
  })

  it('rejects an invalid theme prop', () => {
    expect(() => createThemeController('nope' as TheoThemeProp)).toThrow(/unknown theme "nope"/)
    const c = createThemeController('dark')
    expect(() => c.set('nope' as TheoThemeProp)).toThrow(/unknown theme "nope"/)
    expect(c.get()).toBe('dark')
  })
})
