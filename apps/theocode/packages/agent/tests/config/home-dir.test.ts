/**
 * `home_dir` — one knob that names the directory this product keeps its state in.
 *
 * The hazard it removes is not the name, it is TWO KNOBS THAT CAN DISAGREE. The SDK exposes
 * `sessionDir` for where transcripts are written and honours `THEOKIT_HOME` for where the collector
 * enumerates. Setting only the first was measured on 2026-09-04 to leave the sweep reporting
 * `0 would remove; 0 kept` over a root nothing writes to any more — its own docblock names that
 * shape: "a wrong path that returns nothing is a collector that quietly stopped collecting".
 *
 * So this writes `THEOKIT_HOME`, the variable BOTH halves already read, rather than adding a third
 * thing to keep in sync.
 *
 * A NAME, not a path. `.claude` and `.theocode` are names under the operator's home; an arbitrary
 * path would let a typo in a config file point the collector at `/etc` or at a project directory.
 * Validation is at the boundary, which the parsimony ladder never trades away.
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_HOME_DIR, installTheokitHome, isValidHomeDirName } from '../../src/config/home-dir.js'

describe('the home directory name', () => {
  it('test_the_default_is_the_framework_directory', () => {
    expect(DEFAULT_HOME_DIR).toBe('.theokit')
  })

  it.each(['.theokit', '.theocode', '.claude', 'theo-state'])('test_%s_is_a_valid_name', (n) => {
    expect(isValidHomeDirName(n)).toBe(true)
  })

  it.each([
    ['', 'empty'],
    ['.', 'the current directory'],
    ['..', 'the parent'],
    ['../elsewhere', 'a traversal'],
    ['a/b', 'a separator'],
    ['a\\b', 'a windows separator'],
    ['/etc', 'an absolute path'],
    ['  ', 'whitespace'],
  ])('test_%s_is_refused_because_it_is_%s', (name) => {
    expect(isValidHomeDirName(name)).toBe(false)
  })

  it('test_it_writes_the_variable_both_halves_already_read', () => {
    const env: Record<string, string | undefined> = {}

    installTheokitHome(env, '/home/op', '.claude')

    expect(env.THEOKIT_HOME).toBe('/home/op/.claude')
  })

  it('test_an_explicit_environment_variable_wins_over_the_config_key', () => {
    // An operator who exports THEOKIT_HOME is addressing the SDK directly. Config must not override
    // that, for the same reason `ensureAuthHome` reads `env.X ?? default` rather than assigning.
    const env: Record<string, string | undefined> = { THEOKIT_HOME: '/somewhere/chosen' }

    installTheokitHome(env, '/home/op', '.claude')

    expect(env.THEOKIT_HOME).toBe('/somewhere/chosen')
  })

  it('test_an_invalid_name_throws_rather_than_silently_falling_back', () => {
    // Falling back to the default would move the state root without saying so: the operator asked
    // for one directory, got another, and their transcripts appear to have vanished. Fail-fast at
    // the boundary is the rule this repository states.
    const env: Record<string, string | undefined> = {}

    expect(() => installTheokitHome(env, '/home/op', '../escape')).toThrow(/home_dir/)
    expect(env.THEOKIT_HOME, 'a refused name still moved the root').toBeUndefined()
  })

  it('test_the_default_name_is_installed_when_none_is_configured', () => {
    const env: Record<string, string | undefined> = {}

    installTheokitHome(env, '/home/op')

    expect(env.THEOKIT_HOME).toBe('/home/op/.theokit')
  })
})
