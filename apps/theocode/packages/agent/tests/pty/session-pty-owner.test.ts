/**
 * B-014 — tightening the sandbox reaches the sessions already running.
 *
 * `wrapCommand` reads the current mode at call time, so a NEW command always runs under the current
 * confinement. What `setMode` could not reach is a process already spawned: a `bash -i` started
 * under `danger-full-access` keeps that wrap for its whole life. The owner is the framework's
 * `createPtyOwner`, configured as TheoCode configures it.
 *
 * Loosening is deliberately not disruptive: a session running under a stricter wrap than the current
 * mode is not a hazard, and killing the user's REPL to grant it more access would be gratuitous.
 */
import { createPtyOwner } from '@theokit/agents-pty'
import type { OwnedPtyBackend } from '@theokit/agents-pty'
import { describe, expect, it, vi } from 'vitest'

import { MAX_PTY_SESSIONS } from '../../src/pty/index.js'

function owner(mode: 'read-only' | 'workspace-write' | 'danger-full-access') {
  const created: { killAll: ReturnType<typeof vi.fn> }[] = []
  const o = createPtyOwner({
    mode,
    maxSessions: MAX_PTY_SESSIONS,
    wrapFor: () => () => null,
    createBackend: () => {
      const b = { killAll: vi.fn(), activeSessionCount: vi.fn(() => 1) }
      created.push(b)
      return b as unknown as OwnedPtyBackend
    },
  })
  return { o, created }
}

describe('B-014 — tightening the sandbox ends live sessions', () => {
  it('test_tightening_kills_the_running_backend', () => {
    const { o, created } = owner('danger-full-access')
    o.setMode('read-only')
    expect(created[0]?.killAll).toHaveBeenCalled()
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
