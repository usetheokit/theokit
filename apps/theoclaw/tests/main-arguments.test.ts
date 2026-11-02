import { describe, expect, it } from 'vitest'

import { parseEntryArguments } from '../src/entry-arguments.js'

describe('the process entry arguments', () => {
  it('the_entry_takes_config_and_profile_and_refuses_an_undefined_argument_with_exit_2', () => {
    const env: NodeJS.ProcessEnv = { KEEP: 'x' }
    expect(parseEntryArguments([], env)).toEqual({ ok: true })
    expect(env).toEqual({ KEEP: 'x' })

    expect(parseEntryArguments(['--config', 'C:\\Users\\new dir\\theoclaw.cfg', '--profile', 'work'], env)).toEqual({ ok: true })
    expect(env).toEqual({ KEEP: 'x', THEOCLAW_CONFIG: 'C:\\Users\\new dir\\theoclaw.cfg', THEOCLAW_PROFILE: 'work' })

    const refused = (argv: string[]): string => {
      const result = parseEntryArguments(argv, {})
      if (result.ok) throw new Error(`expected a refusal for ${argv.join(' ')}`)
      return result.error
    }
    expect(refused(['--bogus'])).toContain('--bogus')
    expect(refused(['stray'])).toContain('stray')
    expect(refused(['--config'])).toContain('--config needs a value')
    expect(refused(['--profile', '--config'])).toContain('--profile needs a value')
    expect(refused(['--config', 'a', '--config', 'b'])).toContain('--config')
  })
})
