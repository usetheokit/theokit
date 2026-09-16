/**
 * B-087 — the refusals matter more than the happy path.
 *
 * Switching sessions mid-turn would leave the running turn writing into a transcript nobody is
 * reading, and resuming an id that does not exist would point the session at nothing.
 */
import { describe, expect, it } from 'vitest'

import { planResume } from '../../src/commands/resume-command.js'

const base = { arg: 'tui-b', current: 'tui-a', streaming: false, known: ['tui-a', 'tui-b'] }

describe('B-087 — planResume', () => {
  it('test_resumes_a_known_session', () => {
    expect(planResume(base)).toEqual({ kind: 'resume', id: 'tui-b' })
  })

  it('test_refuses_without_an_id', () => {
    // No default: "the current one" is what you are already in, and guessing the newest would open
    // a session the user did not name.
    expect(planResume({ ...base, arg: '  ' })).toMatchObject({ kind: 'refused' })
  })

  it('test_refuses_while_a_turn_is_running', () => {
    // The hard one. The turn would keep writing into a transcript nobody is looking at.
    const out = planResume({ ...base, streaming: true })
    expect(out).toMatchObject({ kind: 'refused' })
    expect((out as { reason: string }).reason).toContain('esc')
  })

  it('test_refuses_an_unknown_id_rather_than_pointing_at_nothing', () => {
    expect(planResume({ ...base, arg: 'tui-ghost' })).toMatchObject({ kind: 'refused' })
  })

  it('test_says_so_when_already_there', () => {
    // Doing nothing WITHOUT saying so reads as a broken command — the shape B-089 just cost a
    // silent setting change.
    const out = planResume({ ...base, arg: 'tui-a' })
    expect(out).toMatchObject({ kind: 'refused' })
    expect((out as { reason: string }).reason).toContain('already')
  })

  it('test_streaming_outranks_an_unknown_id', () => {
    // Order matters: telling the user their id is wrong while a turn runs sends them to fix the
    // wrong thing.
    const out = planResume({ ...base, arg: 'tui-ghost', streaming: true })
    expect((out as { reason: string }).reason).toContain('esc')
  })
})
