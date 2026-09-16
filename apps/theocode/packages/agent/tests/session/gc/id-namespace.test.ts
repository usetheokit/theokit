/**
 * A session id and a transcript filename are different strings, and this plan compared them.
 *
 * Measured on the built binary, one project created through the TUI:
 *
 *     registry agentId   tui-838055f5-73ea-4e10-af3b-f88482de2e2c
 *     transcript file    80a43d49-8b6b-8f93-9256-60f752a17f2d.jsonl
 *
 * `protectedIds` was filled from THREE sources — registry agent ids, filename stems for the quota,
 * and the pointer's session id — and consulted with a filename stem. Two of the three could never
 * match, so neither a registered session nor the live one was protected; only `keepLast` and
 * most-recent were, because those are filename-derived on both sides.
 *
 * The same mismatch made `inRegistry` always false, which is why every session in a manual run read
 * as `orphan` — a report that looked like an explanation and was an artefact.
 *
 * Expected filenames are computed with the SAME forward mapping production uses. The inverse cannot
 * exist over a hash (usetheokit/theokit-sdk#577) and is not needed: the id is in hand, so ask what it
 * is called.
 */
import { basename } from 'node:path'

import { transcriptPath, transcriptRoot } from '@theokit/agents/persistence'
import { describe, expect, it } from 'vitest'

import { planSessionGC } from '../../../src/session/gc/per-session.js'

const DAY = 86_400_000
const NOW = 1_000 * DAY
const CWD = '/proj'

const REGISTERED = 'tui-838055f5-73ea-4e10-af3b-f88482de2e2c'
const LIVE = 'exec-522dc0ef-9247-4a5b-bdce-e421c29d11b8'
const PLAIN = 'exec-8918b35d-2341-4545-84a7-c62dc9bee641'

const idOf = (session: string) =>
  basename(transcriptPath(transcriptRoot(), CWD, session)).replace(/\.jsonl$/, '')

/** Three transcripts, all old enough to collect; the newest is the one nobody claims. */
function options(overrides: Record<string, unknown> = {}) {
  return {
    cwd: CWD,
    now: () => NOW,
    keepLast: 0,
    maxAgeDays: 30,
    readdir: () => [
      { id: idOf(PLAIN), mtimeMs: NOW - 40 * DAY },
      { id: idOf(REGISTERED), mtimeMs: NOW - 50 * DAY },
      { id: idOf(LIVE), mtimeMs: NOW - 60 * DAY },
    ],
    list: async () => [],
    readPointer: () => undefined,
    ...overrides,
  } as Parameters<typeof planSessionGC>[0]
}

describe('the protected set and the transcripts must be keyed the same way', () => {
  it('test_the_fixture_collects_everything_nobody_claims', async () => {
    // Anti-vacuity floor. Without it, a plan that collected nothing would pass both guards below for
    // free — and the first draft of this file did exactly that, because a single transcript is also
    // the most recent and was protected for a reason unrelated to what was under test.
    const plan = await planSessionGC(options())

    expect(plan.candidates.map((c) => c.id)).toContain(idOf(LIVE))
    expect(plan.candidates.map((c) => c.id)).toContain(idOf(REGISTERED))
  })

  it('test_the_pointer_protects_the_transcript_of_the_session_it_names', async () => {
    const plan = await planSessionGC(options({ readPointer: () => LIVE }))

    expect(
      plan.candidates.map((c) => c.id),
      'the live session named by the pointer was planned for deletion',
    ).not.toContain(idOf(LIVE))
  })

  it('test_a_registered_session_is_protected_and_reported_as_registered', async () => {
    const listed = [{ agentId: REGISTERED, archived: false }]
    const plan = await planSessionGC(options({ list: async () => listed }))

    expect(
      plan.candidates.map((c) => c.id),
      'a session the registry still lists was planned for deletion',
    ).not.toContain(idOf(REGISTERED))
    expect(
      plan.candidates.every((c) => c.inRegistry === false),
      'inRegistry can only be false here, which is what made every session read as an orphan',
    ).toBe(true)
  })
})
