import { describe, expect, it } from 'vitest'

import { parseEntryArguments } from '../src/entry-arguments.js'

describe('the process entry arguments', () => {
  it('the_entry_takes_config_and_profile_and_refuses_an_undefined_argument_with_exit_2', () => {
    const env: NodeJS.ProcessEnv = { KEEP: 'x' }
    expect(parseEntryArguments([], env)).toEqual({ ok: true })
    expect(env).toEqual({ KEEP: 'x' })

    expect(
      parseEntryArguments(
        ['--config', 'C:\\Users\\new dir\\theoclaw.cfg', '--profile', 'work'],
        env,
      ),
    ).toEqual({ ok: true })
    expect(env).toEqual({
      KEEP: 'x',
      THEOCLAW_CONFIG: 'C:\\Users\\new dir\\theoclaw.cfg',
      THEOCLAW_PROFILE: 'work',
    })

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

  // usetheokit/theokit#1143: `FLAGS[flag]` and `value in FLAGS` read the prototype chain, so the names
  // every object inherits were accepted as flags, and a value named like one was refused.
  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf'])(
    'an_inherited_object_name_is_not_a_flag_%s',
    (name) => {
      const env: NodeJS.ProcessEnv = { KEEP: 'x' }
      const result = parseEntryArguments([name, 'value'], env)
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.error).toContain(name)
      expect(env).toEqual({ KEEP: 'x' })
    },
  )

  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    'a_value_named_like_an_inherited_property_is_data_%s',
    (value) => {
      const env: NodeJS.ProcessEnv = {}
      expect(parseEntryArguments(['--config', value], env)).toEqual({ ok: true })
      expect(Object.getOwnPropertyDescriptor(env, 'THEOCLAW_CONFIG')?.value).toBe(value)
    },
  )

  it('a_real_flag_as_a_value_is_still_refused_as_a_missing_value', () => {
    expect(parseEntryArguments(['--config', '--profile'], {})).toEqual({
      ok: false,
      error: '--config needs a value',
    })
  })
})
