import { describe, expect, it, vi } from 'vitest'

import { createThemeController, themes } from '@theokit/tui'

describe('createThemeController', () => {
  it('holds a built-in name, an override and a base-plus-override object', () => {
    const controller = createThemeController('dark')
    expect(controller.get()).toBe('dark')
    const pair = { base: 'light', override: { accent: 'magenta' } } as const
    controller.set(pair)
    expect(controller.get()).toBe(pair)
    controller.set('light')
    expect(controller.get()).toBe('light')
    expect(themes.light).toBeDefined()
  })

  it('notifies on change only, and stops after unsubscribe', () => {
    const controller = createThemeController('dark')
    const listener = vi.fn()
    const off = controller.subscribe(listener)
    controller.set('dark')
    expect(listener).not.toHaveBeenCalled()
    controller.set('light')
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    controller.set('dark')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
