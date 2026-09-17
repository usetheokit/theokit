import { describe, expect, it } from 'vitest'

import { FOREIGN_KEY_DECISIONS } from '../../src/config/settings-file.js'

/**
 * #736 — every key this product's diagnostics name must carry a DECISION, not a silence.
 *
 * The issue's own words: "Decide each documented key: honoured, or explicitly unsupported with the
 * reason." Reporting a key as "not implemented here" says the code does not act on it; it does not
 * say whether that is a refusal or an omission, and an author reading it cannot tell whether to stop
 * writing the key or to wait for it.
 *
 * `permissions`, `hooks`, `outputStyle` and `env` were each decided as this batch went. These four
 * are what was left, and each is decided on what exists HERE rather than on what the reference does:
 *
 * | key | decision | because |
 * |---|---|---|
 * | `model` | honoured | this product has `config.model`; an operator writing it means it |
 * | `cleanupPeriodDays` | honoured | this product has a session GC with a collection window |
 * | `statusLine` | refused | it is a COMMAND SPEC — `.claude/` usually arrives with the clone |
 * | `autoMemoryEnabled` | refused | it toggles a feature this product does not have |
 */
describe('a documented settings key', () => {
  it('test_each_of_the_four_carries_a_decision', () => {
    for (const key of ['model', 'cleanupPeriodDays', 'statusLine', 'autoMemoryEnabled']) {
      const d = FOREIGN_KEY_DECISIONS[key]

      expect(d, `${key} has no decision recorded`).toBeDefined()
      expect(['honoured', 'refused'], `${key}: unknown verdict`).toContain(d!.verdict)
      expect(
        d!.because.split(/\s+/).length,
        `${key}: a decision needs a reason somebody can argue with`,
      ).toBeGreaterThanOrEqual(8)
    }
  })

  it('test_a_refusal_says_what_it_is_about_this_product', () => {
    // The rule the whole surfaces doctrine rests on: a refusal names a reason ABOUT THIS PRODUCT, so
    // an author stops writing the key instead of waiting for it. A reason that only describes the
    // reference ("Claude Code does X") explains nothing about what to do here.
    for (const key of ['statusLine', 'autoMemoryEnabled']) {
      expect(FOREIGN_KEY_DECISIONS[key]!.verdict).toBe('refused')
      expect(FOREIGN_KEY_DECISIONS[key]!.because.toLowerCase()).not.toContain('claude code does')
    }
  })
})
