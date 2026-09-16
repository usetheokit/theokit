/**
 * `/ps` and `/stop`, now that they are reachable without going through the router.
 *
 * The two bodies moved out of `interpret-command.ts` unchanged, and until they did the only thing
 * asserted about them was that the dispatch reached them — the wording, and the distinction the
 * wording carries, was covered nowhere. That distinction is the reason these commands exist: `/stop`
 * with nothing running and `/stop` that killed four shells are different events, and a user who ran
 * it to end a runaway process needs to know which one they just got.
 */
import { describe, expect, it, vi } from 'vitest'

import type { PtysTheInterpreterUses } from '../../src/commands/command-capabilities.js'
import type { ToastPayload } from '../../src/screen-types.js'
import { handleListPtys, handleStopPtys } from '../../src/commands/pty-commands.js'

function ptys(activeSessionCount: number) {
  const killAll = vi.fn()
  const owner = {
    backend: () => ({ activeSessionCount: () => activeSessionCount, killAll }),
  } as unknown as PtysTheInterpreterUses
  return { owner, killAll }
}

function toastFrom(run: (setToast: (t: ToastPayload) => void) => void): ToastPayload {
  const setToast = vi.fn()
  run(setToast)
  const payload = setToast.mock.calls[0]?.[0] as ToastPayload | undefined
  expect(payload, 'the command said nothing').toBeDefined()
  return payload as ToastPayload
}

describe('the background-shell inventory says how many there are', () => {
  it('test_an_empty_set_is_reported_as_none_rather_than_as_zero_sessions', () => {
    const { owner } = ptys(0)

    expect(toastFrom((setToast) => handleListPtys(owner, setToast)).message).toBe(
      'No background shell sessions',
    )
  })

  it('test_a_populated_set_reports_the_count_and_the_way_out', () => {
    // Anti-vacuity for the case above, and the half that matters when something is stuck: a
    // listing that admits sessions exist without naming `/stop` leaves the user with no next step.
    const message = toastFrom((setToast) => handleListPtys(ptys(3).owner, setToast)).message

    expect(message, 'the count is missing').toContain('3')
    expect(message, 'the command that ends them is not named').toContain('/stop')
  })
})

describe('stopping the background shells reports what it actually ended', () => {
  it('test_stopping_nothing_is_not_reported_as_a_success', () => {
    // `success` here would tell a user who ran /stop to kill a runaway process that it was killed.
    const { owner, killAll } = ptys(0)
    const toast = toastFrom((setToast) => handleStopPtys(owner, setToast))

    expect(toast.variant).toBe('info')
    expect(toast.message).toContain('Nothing to stop')
    expect(killAll, 'the backend was asked to kill an empty set').toHaveBeenCalled()
  })

  it('test_stopping_live_sessions_kills_them_and_says_how_many', () => {
    const { owner, killAll } = ptys(2)
    const toast = toastFrom((setToast) => handleStopPtys(owner, setToast))

    expect(killAll, 'the sessions were reported as ended without being ended').toHaveBeenCalled()
    expect(toast.variant).toBe('success')
    expect(toast.message, 'the number ended is not stated').toContain('2')
  })
})
