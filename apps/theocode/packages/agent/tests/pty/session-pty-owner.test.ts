/**
 * B-014 — tightening the sandbox reaches the sessions already running. The owner is the framework's
 * `createPtyOwner`; this pins the configuration TheoCode gives it and the transitions it relies on.
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

describe('B-014 — the sandbox mode and the live sessions', () => {
  it('tightening kills the running backend and installs a fresh one', () => {
    const { o, created } = owner('danger-full-access')
    o.setMode('read-only')
    expect(created[0]?.killAll).toHaveBeenCalled()
    expect(created).toHaveLength(2)
    expect(o.backend()).toBe(created[1] as never)
  })

  it('loosening leaves a running session alone', () => {
    const { o, created } = owner('read-only')
    o.setMode('danger-full-access')
    expect(created[0]?.killAll).not.toHaveBeenCalled()
  })

  it('setting the same mode is a no-op', () => {
    const { o, created } = owner('workspace-write')
    o.setMode('workspace-write')
    expect(created[0]?.killAll).not.toHaveBeenCalled()
    expect(created).toHaveLength(1)
  })
})
