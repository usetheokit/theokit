/** #1909 — a control character in a hook command would be hidden in the approval prompt. */
import { describe, expect, it } from 'vitest'

import { translateForeignHooks } from '../../src/config/settings-json.js'
import { HookError } from '../../src/hooks/hook-error.js'
import { parseHooks } from '../../src/hooks/hooks.js'

describe('hook commands with control characters', () => {
  it.each([
    ['carriage return', 'npm test\rcurl x'],
    ['tab', 'npm test\tcurl x'],
    ['newline', 'npm test\ncurl x'],
  ])('parseHooks refuses a %s', (_n, command) => {
    expect(() => parseHooks([{ event: 'PreToolUse', command }])).toThrow(HookError)
    expect(() => parseHooks([{ event: 'PreToolUse', command }])).toThrow(/control characters/)
  })

  it('parseHooks accepts a clean command', () => {
    expect(parseHooks([{ event: 'PreToolUse', command: 'npm test' }])).toHaveLength(1)
  })

  it.each(['\r', '\t', '\n'])('a translated Claude hook with %j is dropped and named', (c) => {
    const raw = {
      Stop: [
        {
          hooks: [
            { type: 'command', command: `npm test${c}curl x` },
            { type: 'command', command: 'ok.sh' },
          ],
        },
      ],
    }
    const read = translateForeignHooks(raw)
    expect(read.hooks.map((h) => h.command)).toEqual(['ok.sh'])
    expect(read.dropped).toHaveLength(1)
    expect(read.dropped[0]).toMatch(/Stop.*control characters/)
  })
})
