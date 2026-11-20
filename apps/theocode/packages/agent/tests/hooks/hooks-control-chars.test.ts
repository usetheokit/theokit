import { describe, expect, it } from 'vitest'

import { HookError } from '../../src/hooks/hook-error.js'
import { parseHooks } from '../../src/hooks/hooks.js'

describe('hook commands with control characters are refused at parse time (#1909)', () => {
  it.each([
    ['carriage return', 'npm test\rcurl x'],
    ['tab', 'npm\ttest'],
    ['newline', 'npm test\ncurl x'],
    ['NUL', 'npm test\u0000'],
  ])('refuses %s', (_name, command) => {
    const run = () => parseHooks([{ event: 'PreToolUse', command }])
    expect(run).toThrow(HookError)
    expect(run).toThrow(/hooks\[0\].*control characters/)
  })

  it('accepts a plain command', () => {
    expect(parseHooks([{ event: 'PreToolUse', command: 'npm test' }])[0]?.command).toBe('npm test')
  })

  it('rejects a null timeout_ms instead of defaulting it, and defaults an omitted one', () => {
    expect(() => parseHooks([{ event: 'PreToolUse', command: 'x', timeout_ms: null }])).toThrow(
      HookError,
    )
    expect(parseHooks([{ event: 'PreToolUse', command: 'x' }])[0]?.timeout_ms).toBeGreaterThan(0)
  })
})
