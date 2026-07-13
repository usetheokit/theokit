/**
 * debugLog gates the agent-run wiring metrics behind THEOKIT_DEBUG so they never pollute stdout by default
 * (G9 — no unconditional `console.*` in production paths; the TUI/piped-output regression that motivated it).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { debugLog } from '../../src/debug-log.js'

describe('debugLog', () => {
  const original = process.env.THEOKIT_DEBUG

  afterEach(() => {
    if (original === undefined) delete process.env.THEOKIT_DEBUG
    else process.env.THEOKIT_DEBUG = original
    vi.restoreAllMocks()
  })

  it('is silent when THEOKIT_DEBUG is unset', () => {
    delete process.env.THEOKIT_DEBUG
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    debugLog('[MARKER]', { a: 1 })
    expect(spy).not.toHaveBeenCalled()
  })

  it.each(['', '0', 'false'])('is silent when THEOKIT_DEBUG is %o (falsy)', (value) => {
    process.env.THEOKIT_DEBUG = value
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    debugLog('[MARKER]', { a: 1 })
    expect(spy).not.toHaveBeenCalled()
  })

  it('emits the marker + data when THEOKIT_DEBUG is set', () => {
    process.env.THEOKIT_DEBUG = '1'
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    debugLog('[MARKER]', { a: 1 })
    expect(spy).toHaveBeenCalledWith('[MARKER]', { a: 1 })
  })
})
