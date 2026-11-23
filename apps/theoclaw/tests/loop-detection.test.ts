import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { LOOP_REPEAT_LIMIT, LOOP_WINDOW, untrustedContentSendOptions } from '../src/agent/untrusted-content.js'

// The repeat guard is the SDK's window guard (`sendDefaults.doomLoop`), set once for every agent (#2702).
describe('loop detection', () => {
  it('sends the SDK window guard with limit 3 and window 20', () => {
    expect(LOOP_REPEAT_LIMIT).toBe(3)
    expect(LOOP_WINDOW).toBe(20)
    expect(untrustedContentSendOptions().doomLoop).toEqual({ window: 20, windowRepeatLimit: 3 })
  })

  it('has no app-owned plugin any more', () => {
    expect(existsSync(fileURLToPath(new URL('../src/tools/loop-detection.ts', import.meta.url)))).toBe(false)
  })
})
