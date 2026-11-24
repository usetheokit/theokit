import { describe, expect, it } from 'vitest'

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { InstanceConfigError } from '@theokit/host/instance-config'

import { theoclawConfig } from '../src/config-file.js'

// The shared parser, as `main.ts` and `main-acp.ts` call it: a refusal throws, and the entries exit 2.
type Result = { ok: true } | { ok: false; error: string }
function parseEntryArguments(argv: string[], env: NodeJS.ProcessEnv): Result {
  try {
    theoclawConfig.applyEntryArgs(argv, env)
    return { ok: true }
  } catch (error) {
    if (!(error instanceof InstanceConfigError)) throw error
    return { ok: false, error: error.message }
  }
}

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

// The process entries map the shared parser's refusal to exit 2 (run from source: `dist` may not be built).
describe.each(['main.ts', 'main-acp.ts'])('the process entry %s', (entry) => {
  it.each([
    [['--profile'], '--profile needs a value'],
    [['--bogus'], 'unexpected argument --bogus'],
    [['--config', 'a', '--config', 'b'], '--config was given twice'],
  ])('exits_2_for_%j', (argv, message) => {
    const path = fileURLToPath(new URL(`../src/${entry}`, import.meta.url))
    const run = spawnSync(process.execPath, ['--import', 'tsx', path, ...argv], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, THEOCLAW_CONFIG: '', THEOCLAW_PROFILE: '' } })
    expect(run.status).toBe(2)
    expect(run.stderr).toContain(`theoclaw: ${message}`)
  })
})
