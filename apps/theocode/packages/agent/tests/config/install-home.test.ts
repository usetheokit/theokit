/**
 * Installing the configured home at bootstrap, without letting a config file take the product down.
 *
 * This runs before anything else resolves an SDK path, which means it runs before the product has
 * any way to report a problem nicely. `resolveEffectiveConfig` THROWS on a malformed
 * `config.toml`, and a throw here kills the process at startup — the same hazard `guardedSweepStart`
 * exists for, one bootstrap earlier.
 *
 * So a config that cannot be read installs the DEFAULT name and says so. That is the safe direction
 * rather than a swallow: the default is where every existing installation's state already is, and
 * the same malformed file is about to be reported properly by the normal config path a moment later.
 * Choosing any other directory on the strength of a file we could not parse would move the state
 * root on a guess.
 */
import { describe, expect, it } from 'vitest'

import { installConfiguredHome } from '../../src/config/install-home.js'

const reader = (name: string | undefined) => () => ({ home_dir: name }) as never
const throwing = () => {
  throw new Error('config.toml: unexpected character at line 3')
}

describe('installConfiguredHome', () => {
  it('test_it_installs_the_configured_name', () => {
    const env: Record<string, string | undefined> = {}

    installConfiguredHome({ env, home: '/home/op', read: reader('.claude'), onWarn: () => {} })

    expect(env.THEOKIT_HOME).toBe('/home/op/.claude')
  })

  it('test_a_config_that_throws_installs_the_default_and_reports_it', () => {
    const env: Record<string, string | undefined> = {}
    const said: string[] = []

    expect(() =>
      installConfiguredHome({ env, home: '/home/op', read: throwing, onWarn: (m) => said.push(m) }),
    ).not.toThrow()

    expect(env.THEOKIT_HOME, 'a broken config moved the state root').toBe('/home/op/.theokit')
    expect(said.join(' '), 'the fallback was silent').toContain('line 3')
  })

  it('test_an_invalid_name_installs_the_default_and_reports_it', () => {
    // The name is refused, and the refusal must not take the terminal down at startup either. The
    // throw belongs to `installTheokitHome`, which the normal config path also exercises; here it is
    // caught and reported, and the state root stays where the operator's transcripts are.
    const env: Record<string, string | undefined> = {}
    const said: string[] = []

    installConfiguredHome({
      env,
      home: '/home/op',
      read: reader('../escape'),
      onWarn: (m) => said.push(m),
    })

    expect(env.THEOKIT_HOME).toBe('/home/op/.theokit')
    expect(said.join(' ')).toContain('home_dir')
  })

  it('test_an_explicit_environment_variable_still_wins', () => {
    const env: Record<string, string | undefined> = { THEOKIT_HOME: '/chosen' }

    installConfiguredHome({ env, home: '/home/op', read: reader('.claude'), onWarn: () => {} })

    expect(env.THEOKIT_HOME).toBe('/chosen')
  })

  it('test_a_healthy_default_config_reports_nothing', () => {
    // Anti-vacuity: a function that always warned would satisfy the two cases above.
    const said: string[] = []

    installConfiguredHome({
      env: {},
      home: '/home/op',
      read: reader(undefined),
      onWarn: (m) => said.push(m),
    })

    expect(said).toEqual([])
  })
})
