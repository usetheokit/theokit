/**
 * B-014 — tightening the sandbox reaches the sessions already running.
 *
 * `wrapCommand` reads the current mode at call time, so a NEW command always runs under the current
 * confinement. What `setMode` could not reach is a process already spawned: a `bash -i` started
 * under `danger-full-access` keeps that wrap for its whole life, and `rotate()` was only called on
 * session reset. Switching to read-only left the permissive shell alive and interactive.
 *
 * Loosening is deliberately not disruptive: a session running under a stricter wrap than the current
 * mode is not a hazard, and killing the user's REPL to grant it more access would be gratuitous.
 */
import { describe, expect, it, vi } from 'vitest'

import { createSessionPtyOwner } from '../../src/pty/session-pty-owner.js'

/** A backend that records whether it was killed, so ownership transitions are observable. */
function fakeBackend() {
  const killAll = vi.fn()
  return { killAll, dispose: vi.fn(), start: vi.fn(), write: vi.fn() } as never
}

function owner(initialMode: 'read-only' | 'workspace-write' | 'danger-full-access') {
  const created: { killAll: ReturnType<typeof vi.fn> }[] = []
  const o = createSessionPtyOwner({
    initialMode,
    maxSessions: 4,
    createWrap: () => () => null,
    createBackend: () => {
      const b = fakeBackend() as unknown as { killAll: ReturnType<typeof vi.fn> }
      created.push(b)
      return b as never
    },
  })
  return { o, created }
}

describe('B-014 — tightening the sandbox ends live sessions', () => {
  it('test_tightening_kills_the_running_backend', () => {
    const { o, created } = owner('danger-full-access')

    o.setMode('read-only')

    expect(
      created[0]?.killAll,
      'a shell spawned under danger-full-access stayed alive and interactive after the mode was ' +
        'tightened to read-only — the wrap is fixed at spawn time, so the running process kept the ' +
        'permissive confinement',
    ).toHaveBeenCalled()
  })

  it('test_tightening_installs_a_fresh_backend', () => {
    const { o, created } = owner('danger-full-access')

    o.setMode('workspace-write')

    expect(created).toHaveLength(2)
    expect(o.backend()).toBe(created[1] as never)
  })
})

describe('B-014 — loosening and no-ops leave sessions alone', () => {
  it('test_loosening_does_not_kill_a_running_session', () => {
    // A session confined MORE than the current mode is not a hazard; ending the user's REPL to
    // grant it more access would be gratuitous.
    const { o, created } = owner('read-only')

    o.setMode('danger-full-access')

    expect(created[0]?.killAll).not.toHaveBeenCalled()
  })

  it('test_setting_the_same_mode_is_a_no_op', () => {
    const { o, created } = owner('workspace-write')

    o.setMode('workspace-write')

    expect(created[0]?.killAll).not.toHaveBeenCalled()
    expect(created).toHaveLength(1)
  })
})
