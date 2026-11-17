/**
 * The two numeric defaults of `theocode sessions gc` that decide what gets DELETED.
 *
 * These tests omit `keepLast` / `maxAgeDays` on purpose: they pin 10 and 30 in the command, so a
 * silent change to either number is a red test rather than a silently wider deletion window.
 */
import { describe, expect, it } from 'vitest'

import { planAndRunCurrentProjectGC } from '../../../../cli/src/commands/sessions.js'
import { NOW, useFixture, writeTranscript } from './gc-command-fixture.js'

const fx = useFixture()
const plan = (extra: { keepLast?: number; maxAgeDays?: number } = {}) =>
  planAndRunCurrentProjectGC({
    cwd: fx.cwd,
    root: fx.root,
    now: NOW,
    apply: false,
    listRegistry: async () => [],
    ...extra,
  }).then((r) => r.plan)

describe('sessions gc defaults', () => {
  it('keeps_the_ten_newest_transcripts_when_keepLast_is_not_given', async () => {
    for (let i = 0; i < 12; i++) writeTranscript(fx, `t-${String(i).padStart(2, '0')}`, 100 + i)

    const p = await plan()

    expect(p.candidates.map((c) => c.id).sort((a, b) => String(a).localeCompare(String(b)))).toEqual(
      ['t-10', 't-11'],
    )
    expect(p.kept).toHaveLength(10)
  })

  it('collects_past_thirty_days_and_keeps_younger_when_maxAgeDays_is_not_given', async () => {
    writeTranscript(fx, 't-00', 1)
    writeTranscript(fx, 't-01', 29)
    writeTranscript(fx, 't-02', 31)

    const p = await plan({ keepLast: 1 })

    expect(p.candidates.map((c) => c.id)).toEqual(['t-02'])
    expect(p.kept.map((k) => k.id)).toContain('t-01')
  })
})
