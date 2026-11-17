/**
 * #106 / #1918 — a transcript whose id cannot be read is never deleted as an orphan.
 *
 * The framework collects such a file as an "unnameable" orphan; the command keeps it, because
 * "I could not read this" is not "this belongs to nobody" and `unlink` has no undo.
 */
import { existsSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { planAndRunCurrentProjectGC } from '../../../../cli/src/commands/sessions.js'
import { NOW, useFixture, writeTranscript } from './gc-command-fixture.js'

const fx = useFixture()
const run = () =>
  planAndRunCurrentProjectGC({
    cwd: fx.cwd,
    root: fx.root,
    now: NOW,
    keepLast: 1,
    maxAgeDays: 1,
    apply: true,
    listRegistry: async () => [],
    removeFromRegistry: () => undefined,
  })

describe('#106 — unreadable is not orphaned', () => {
  it('test_a_transcript_whose_id_cannot_be_read_is_kept', async () => {
    writeTranscript(fx, 'decoy-newer', 1)
    const bad = writeTranscript(fx, 'unreadable-one', 90, { content: 'not json {' })

    const { plan, result } = await run()

    expect(plan.candidates).toHaveLength(0)
    expect(result.orphaned).toEqual([])
    expect(existsSync(bad), 'an unreadable transcript was deleted as an orphan').toBe(true)
  })

  it('test_a_readable_orphan_is_still_collected', async () => {
    // Anti-vacuity: keeping everything would satisfy the arm above and turn `gc` into a no-op.
    writeTranscript(fx, 'decoy-newer', 1)
    const orphan = writeTranscript(fx, 'readable-orphan', 90)

    await run()

    expect(existsSync(orphan)).toBe(false)
  })

  it('test_an_entry_with_no_idSource_at_all_keeps_todays_behaviour', async () => {
    // A plain readable transcript carries no extra marker; absence must mean "no reason to doubt",
    // or adopting the unreadable-keep rule would switch `gc` off for ordinary entries.
    writeTranscript(fx, 'decoy-newer', 1)
    const plain = writeTranscript(fx, 'plain-old-entry', 90)

    const { plan } = await run()

    expect(plan.candidates.map((c) => c.id)).toContain('plain-old-entry')
    expect(existsSync(plain)).toBe(false)
  })
})
