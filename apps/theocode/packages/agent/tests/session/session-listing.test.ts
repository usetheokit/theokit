/**
 * #124 — every session this product creates is listable, whatever surface minted its id.
 *
 * `listSessions` kept only ids beginning with `tui-`. Three surfaces mint ids: the TUI (`tui-`), the
 * headless CLI (`exec-`) and the review runner (`review-`). So **100% of the sessions created by
 * the headless CLI were invisible** to the only command that reveals an id — and `archive`,
 * `rename`, `delete` and `fork` all take one, which made four operations unreachable from that
 * surface.
 *
 * The message made it worse: `no sessions for this directory` ASSERTS ABSENCE. It does not describe
 * a filter, so the honest reading of the output is that the session does not exist — while
 * `resume --last` resumed it, `rename` renamed it on disk, and `sessions gc` counted it as `1 kept`.
 * Four commands in one family disagreeing about whether the same session exists.
 *
 * ## Why the filter is removed rather than widened
 *
 * Listing the three known prefixes would be the same defect in miniature: a fourth surface mints a
 * fourth prefix and is invisible again, silently, exactly as `exec-` was from the first commit.
 *
 * What settles it is that this codebase already has an answer to "what is a session", and it is not
 * the name. `gc/filesystem.ts:98` and `gc/per-session.ts:203` build the DELETION PROTECTION SET from
 * this same listing with no filter at all. Two answers to that question in one codebase is how the
 * two come to disagree — and here the stricter of the two was guarding a display while the looser
 * one guarded deletion, which is the wrong way round.
 */
import { describe, expect, it } from 'vitest'

import { sessionsFrom } from '../../src/session/session-ops.js'

const AGENT = (agentId: string): Parameters<typeof sessionsFrom>[0][number] => ({
  agentId,
  name: 'a session',
  archived: false,
  lastModified: 1,
})

describe('which agents are sessions', () => {
  it('test_every_surfaces_id_is_listed', () => {
    const listed = sessionsFrom([AGENT('tui-1'), AGENT('exec-2'), AGENT('review-3')])
    expect(listed.map((s) => s.agentId)).toEqual(['tui-1', 'exec-2', 'review-3'])
  })

  it('test_the_headless_id_specifically_survives', () => {
    // The regression, named on its own: this is the exact id shape `preflight.ts` mints, and it is
    // the one the filter dropped for every headless run since the first commit.
    expect(sessionsFrom([AGENT('exec-e2750fde-0000-4000-8000-000000000000')])).toHaveLength(1)
  })

  it('test_an_empty_registry_still_produces_an_empty_listing', () => {
    // Anti-vacuity floor: a function that returned its input unconditionally would pass the arms
    // above, so the empty case has to be asserted rather than assumed.
    expect(sessionsFrom([])).toEqual([])
  })

  it('test_the_fields_the_listing_promises_are_carried_through', () => {
    const [only] = sessionsFrom([
      { agentId: 'exec-1', name: 'named', archived: true, lastModified: 42 },
    ])
    expect(only).toEqual({ agentId: 'exec-1', name: 'named', archived: true, lastModified: 42 })
  })

  it('test_a_missing_archived_flag_reads_as_not_archived', () => {
    // The registry omits the field for a session that was never archived, and `archived` is what
    // the caller branches on — `undefined` there would read as truthy in a template and print
    // "archived" for a live session.
    expect(sessionsFrom([{ agentId: 'exec-1' }])[0]?.archived).toBe(false)
  })
})
