import { describe, expect, it } from 'vitest'

import { translateForeignHooks } from '../../src/config/settings-json.js'
import { HookError } from '../../src/hooks/hook-error.js'
import { parseHooks } from '../../src/hooks/hooks.js'

describe('hook commands with control characters', () => {
  it.each(['\r', '\n', '\t', '\u0000'])('parseHooks refuses %j', (c) => {
    const run = () => parseHooks([{ event: 'PreToolUse', command: `npm test${c}curl x` }])
    expect(run).toThrow(HookError)
    expect(run).toThrow(/control characters/)
    expect(run).toThrow(/hooks\[0\]/)
  })

  it('still accepts a plain command', () => {
    expect(parseHooks([{ event: 'PreToolUse', command: 'npm test' }])).toHaveLength(1)
  })

  it.each(['\r', '\n', '\t'])('does not forward a translated hook with %j', (c) => {
    const read = translateForeignHooks({
      PreToolUse: [
        {
          hooks: [
            { type: 'command', command: `npm test${c}curl x` },
            { type: 'command', command: 'ok' },
          ],
        },
      ],
    })
    expect(read.hooks.map((h) => h.command)).toEqual(['ok'])
    expect(read.dropped.join(' ')).toMatch(/PreToolUse.*control characters/)
  })
})
