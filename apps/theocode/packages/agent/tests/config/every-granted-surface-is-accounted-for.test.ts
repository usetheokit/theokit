/**
 * Every surface the dialect grants is reported somewhere, and a new one cannot arrive in silence.
 *
 * ## The gap this closes
 *
 * `foreign-surfaces-on-disk.ts` carries the coverage argument in a docblock, dated 2026-09-15:
 * `skills` and `plugins` are covered by `skills-on-disk`, `subagents` appears there as `agents`,
 * `commands` is in the same list, and `context` is the `[rules]` diagnostic the instruction tree
 * emits. It ends by saying the check was worth running — "a fix covering four of five surfaces
 * would have left the fifth in the silence this whole file exists to end".
 *
 * That reasoning is right and it was PROSE. Nothing held `FOREIGN_SURFACES` against it, so a sixth
 * grant would join the list and be reported by nobody, with the docblock still claiming every one
 * is accounted for. A README audit on 2026-09-17 found two claims in exactly that state — true when
 * measured, false when read, with no mechanism able to notice.
 *
 * So the map is data now, and the test is that it MATCHES the grant. It asserts an equality rather
 * than an inclusion: a surface removed from the grant and left here would be coverage claimed for
 * something nobody imports any more.
 */
import { describe, expect, it } from 'vitest'

import { FOREIGN_SURFACES } from '../../src/setting-sources.js'

/** Where each granted surface is reported to the operator. Verbatim from the docblock it pins. */
const REPORTED_BY: Readonly<Record<string, string>> = {
  skills: 'skills-on-disk',
  plugins: 'skills-on-disk, via bundledSkillNames walking <plugins>/<bundle>/skills/<name>',
  subagents: 'foreign-surfaces-on-disk, as `agents`',
  commands: 'foreign-surfaces-on-disk',
  context: 'the [rules] diagnostic the instruction tree emits',
}

describe('every granted foreign surface is reported somewhere', () => {
  it('test_the_grant_and_the_coverage_map_are_the_same_set', () => {
    expect(
      [...FOREIGN_SURFACES].sort((a, b) => a.localeCompare(b)),
      'a granted surface with no entry here is reported by nobody, and a stale entry claims ' +
        'coverage for something no longer imported — add the surface to a reporter first, then name ' +
        'it here',
    ).toEqual(Object.keys(REPORTED_BY).sort((a, b) => a.localeCompare(b)))
  })

  it('test_each_entry_names_where_it_is_reported', () => {
    // The anti-vacuity floor. A map of empty strings would satisfy the equality above while
    // recording nothing a reader could follow.
    const vague = Object.entries(REPORTED_BY).filter(([, where]) => where.trim().length < 12)
    expect(vague, 'an entry that does not name a reporter is a placeholder').toEqual([])
  })
})
