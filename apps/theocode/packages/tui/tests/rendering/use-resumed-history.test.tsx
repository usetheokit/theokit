/**
 * #70 — loading a resumed session's turns, once, without blocking the frame.
 *
 * The read is asynchronous and the surface must stay usable while it runs: a resume that froze the
 * TUI until a transcript parsed would trade one bad outcome for a worse one.
 *
 * Three behaviours are load-bearing and each has a test below: it loads only for a session that was
 * RESUMED, it forgets the previous session's turns the moment the id changes, and a failed read
 * leaves an empty screen rather than propagating.
 */
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'

import { useResumedHistory } from '../../src/rendering/use-resumed-history.js'

type Read = Parameters<typeof useResumedHistory>[2]

async function drive(
  steps: readonly { sessionId: string | undefined; resumed: boolean }[],
  read: Read,
): Promise<{ seen: readonly unknown[]; calls: number }> {
  let seen: readonly unknown[] = []
  let calls = 0
  const counted: Read = async (id, warn) => {
    calls += 1
    // `read` is required at every call site below; the parameter is optional only because the hook's
    // own default supplies it.
    return (read as NonNullable<Read>)(id, warn)
  }
  function Probe({ sessionId, resumed }: { sessionId: string | undefined; resumed: boolean }): null {
    seen = useResumedHistory(sessionId, resumed, counted)
    return null
  }
  const first = steps[0] as { sessionId: string | undefined; resumed: boolean }
  const instance = render(<Probe sessionId={first.sessionId} resumed={first.resumed} />)
  let current = first
  // Settled by RE-RENDERING until the effect's promise has landed, not by waiting a fixed number of
  // milliseconds. The first version slept 5ms between steps and 20ms at the end: it passed alone and
  // failed once under the full suite, where the machine is loaded. `rules/testing.md` calls a flaky
  // test a bug rather than a nuisance. The bound is iterations, so a genuinely stuck effect still
  // fails instead of hanging.
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 50; i += 1) {
      await Promise.resolve()
      instance.rerender(<Probe sessionId={current.sessionId} resumed={current.resumed} />)
    }
  }
  await settle()
  for (const step of steps.slice(1)) {
    current = step
    instance.rerender(<Probe sessionId={step.sessionId} resumed={step.resumed} />)
    await settle()
  }
  instance.unmount()
  return { seen, calls }
}

const oneTurn = [{ role: 'assistant' as const, text: 'earlier turn' }]

describe('#70 — useResumedHistory', () => {
  it('test_a_resumed_session_gets_its_turns', async () => {
    const { seen } = await drive([{ sessionId: 's1', resumed: true }], async () => oneTurn)

    expect(JSON.stringify(seen)).toContain('earlier turn')
  })

  it('test_a_fresh_session_is_never_read', async () => {
    // The anti-vacuity floor: a hook that read unconditionally would satisfy the case above and
    // would also re-render every new session with somebody else's turns.
    const { seen, calls } = await drive([{ sessionId: 's1', resumed: false }], async () => oneTurn)

    expect(calls, 'a session that was not resumed was read anyway').toBe(0)
    expect(seen).toEqual([])
  })

  it('test_no_session_id_is_not_read', async () => {
    const { calls } = await drive([{ sessionId: undefined, resumed: true }], async () => oneTurn)

    expect(calls).toBe(0)
  })

  it('test_switching_sessions_drops_the_previous_turns', async () => {
    // /resume twice. Showing the first session's turns under the second one's greeting is worse
    // than showing none: it attributes work to a conversation that did not contain it.
    const read: Read = async (id) => [{ role: 'assistant' as const, text: `turns of ${id}` }]

    const { seen } = await drive(
      [
        { sessionId: 's1', resumed: true },
        { sessionId: 's2', resumed: true },
      ],
      read,
    )

    const json = JSON.stringify(seen)
    expect(json).toContain('turns of s2')
    expect(json, "the previous session's turns are still on screen").not.toContain('turns of s1')
  })

  it('test_a_failed_read_leaves_an_empty_history_rather_than_throwing', async () => {
    const warn = vi.fn()
    const { seen } = await drive([{ sessionId: 's1', resumed: true }], async (_id, onWarn) => {
      onWarn?.('disk on fire')
      warn('called')
      return []
    })

    expect(seen).toEqual([])
    expect(warn).toHaveBeenCalled()
  })
})
