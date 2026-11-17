/**
 * A session id and a transcript filename are different strings (#1918, was the planner's own check).
 *
 * A registry id `tui-838055f5-…` names a file called `80a43d49-….jsonl`, so protection must be keyed
 * the same way the transcripts are. The anti-vacuity arm proves the fixture collects what nobody
 * claims, so the two guards below cannot pass by a plan that collected nothing.
 */
import { describe, expect, it } from 'vitest'

import { planAndRunCurrentProjectGC } from '../../../../cli/src/commands/sessions.js'
import { NOW, useFixture, writePointer, writeTranscript } from './gc-command-fixture.js'

const REGISTERED = 'tui-838055f5-73ea-4e10-af3b-f88482de2e2c'
const LIVE = 'exec-522dc0ef-9247-4a5b-bdce-e421c29d11b8'
const PLAIN = 'exec-8918b35d-2341-4545-84a7-c62dc9bee641'

const fx = useFixture()

function planFull(registry: { agentId: string; archived?: boolean }[] = []) {
  writeTranscript(fx, 'newest', 1)
  writeTranscript(fx, PLAIN, 40)
  writeTranscript(fx, REGISTERED, 50)
  writeTranscript(fx, LIVE, 60)
  return planAndRunCurrentProjectGC({
    cwd: fx.cwd,
    root: fx.root,
    now: NOW,
    keepLast: 1,
    maxAgeDays: 30,
    apply: false,
    listRegistry: async () => registry,
  }).then((r) => r.plan)
}

const plan = (registry: { agentId: string; archived?: boolean }[] = []) =>
  planFull(registry).then((p) => p.candidates.map((c) => c.id))

describe('the protected set and the transcripts are keyed the same way', () => {
  it('test_the_fixture_collects_everything_nobody_claims', async () => {
    const ids = await plan()
    expect(ids).toContain(LIVE)
    expect(ids).toContain(REGISTERED)
  })

  it('test_the_pointer_protects_the_transcript_of_the_session_it_names', async () => {
    writePointer(fx, LIVE)
    expect(await plan(), 'the session named by the pointer was planned').not.toContain(LIVE)
  })

  it('test_a_registered_session_is_protected_and_reported_as_registered', async () => {
    const ids = await plan([{ agentId: REGISTERED, archived: false }])
    expect(ids, 'a session the registry still lists was planned').not.toContain(REGISTERED)
    // Reported as registered: the kept list says why, which is what `inRegistry` used to show.
    const full = await planFull([{ agentId: REGISTERED, archived: false }])
    expect(full.kept.find((k) => k.id === REGISTERED)?.reason).toBe('registered session')
  })
})
