/**
 * #70 — a resumed session must SAY it was resumed.
 *
 * The screen after `/resume` is the welcome banner and an empty transcript: identical to a command
 * that did nothing. The context is genuinely there — ask the model about the previous turn and it
 * answers — so the two outcomes a user must tell apart look the same.
 *
 * The affordance already existed and reached only half the cases: `useTimeline(agent, resumed)`
 * writes "(resumed — I remember our last conversation)" into the greeting, and `resumed` was bound
 * to `resumeOnStartup`, which is true only when the PROCESS started on a session pointer. A
 * mid-session `/resume` left it false, so the one place that could have said so said nothing.
 *
 * WHAT THIS DOES NOT DO, and the issue's acceptance criterion asks for it: render the history
 * itself. That needs two things `@theokit/sdk@4.63.4-next.0` and `@theokit/tui@0.79.0` do not offer
 * publicly — `readSessionMessages` exists in the SDK's compiled code but not in its `.d.ts`, and the
 * toolkit exposes no way to seed `agent.thread`. Both are filed upstream. Reaching into
 * `dist/chunk-*.js` to get at the first would be a private contract this product cannot hold.
 */
import { describe, expect, it } from 'vitest'

import { greetingFor } from '../../src/rendering/resumed-banner.js'

describe('the greeting after a resume', () => {
  it('test_a_fresh_session_greets_plainly', () => {
    expect(greetingFor(false)).not.toContain('resumed')
  })

  it('test_a_session_resumed_at_startup_says_so', () => {
    expect(greetingFor(true)).toContain('resumed')
  })

  it('test_it_names_the_way_out', () => {
    // A user who did not mean to resume needs the next step in the same breath, not a state they
    // have to discover how to leave.
    expect(greetingFor(true)).toContain('/new')
  })
})
