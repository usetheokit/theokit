import { describe, expect, it } from 'vitest'

import { permissionRulesFromSettings } from '../../src/config/settings-permissions.js'

/**
 * A path specifier matches the EQUIVALENT FORMS of the same file, and nothing else.
 *
 * `Read(./off-limits.txt)` rendered to `/^\.\/off-limits\.txt$/`, which matches the literal string
 * and nothing a caller actually passes: a tool receives `off-limits.txt` or an absolute path.
 * Measured 2026-09-17 end to end — the rule was carried by the plugin, the regex never fired, and the
 * file was read.
 *
 * The fix is NOT a looser pattern. `(^|/)name$` would also deny `/somewhere/else/off-limits.txt`,
 * which is the "matched almost the right calls" this module refuses by design. What widens is the
 * set of SPELLINGS of one path — `./x`, `x`, and `<base>/x` are the same file — and the absolute form
 * is anchored to the directory the settings file lives in, so nothing outside it is reachable.
 */
describe('a path specifier', () => {
  const base = '/project'
  const rule = (entry: string): RegExp | undefined => {
    const { rules } = permissionRulesFromSettings(
      { deny: [entry] },
      { specifierArg: { Read: 'path' }, baseDir: base },
    )
    return (rules[0] as { args?: Record<string, RegExp> } | undefined)?.args?.path
  }

  it('test_it_matches_the_three_spellings_of_the_same_file', () => {
    const re = rule('Read(./off-limits.txt)')

    expect(re?.test('./off-limits.txt'), 'the form the operator wrote').toBe(true)
    expect(re?.test('off-limits.txt'), 'the bare form a tool receives').toBe(true)
    expect(re?.test('/project/off-limits.txt'), 'the absolute form').toBe(true)
  })

  it('test_it_does_not_match_the_same_name_elsewhere', () => {
    // The control that keeps this a normalisation rather than a glob.
    const re = rule('Read(./off-limits.txt)')

    expect(re?.test('/elsewhere/off-limits.txt')).toBe(false)
    expect(re?.test('nested/off-limits.txt')).toBe(false)
  })

  it('test_a_non_path_specifier_is_unchanged', () => {
    // `Bash(rm:*)` is a command prefix, not a path. Nothing about it should gain path spellings.
    const { rules } = permissionRulesFromSettings({ deny: ['Bash(rm:*)'] }, { baseDir: base })
    const re = (rules[0] as { args?: Record<string, RegExp> }).args?.command

    expect(re?.test('rm -rf /')).toBe(true)
    expect(re?.test('/project/rm')).toBe(false)
  })
})
