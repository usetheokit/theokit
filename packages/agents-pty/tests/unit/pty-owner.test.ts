import { describe, it, expect } from 'vitest'

import { createPtyOwner, PtyOwnerConfigError } from '../../src/index.js'
import type { OwnedPtyBackend } from '../../src/index.js'
import type { PtyInteractiveBackendOptions } from '@theokit/sdk-pty'

type Mode = 'read-only' | 'workspace-write' | 'danger-full-access'

function harness(mode: Mode, live = 2) {
  const built: Array<{ options: PtyInteractiveBackendOptions; kills: number }> = []
  const wraps: Mode[] = []
  const owner = createPtyOwner<Mode>({
    mode,
    maxSessions: 4,
    wrapFor: (m) => (command) => {
      wraps.push(m)
      return command
    },
    createBackend: (options) => {
      const record = { options, kills: 0 }
      built.push(record)
      return {
        killAll: () => {
          record.kills += 1
        },
        activeSessionCount: () => live,
      } as unknown as OwnedPtyBackend
    },
  })
  return { owner, built, wraps }
}

describe('createPtyOwner', () => {
  it('tightening the mode kills live sessions and builds a new backend', () => {
    const { owner, built } = harness('danger-full-access')
    const first = owner.backend()
    expect(owner.setMode('read-only')).toEqual({ killed: 2 })
    expect(built[0]?.kills).toBe(1)
    expect(built).toHaveLength(2)
    expect(owner.backend()).not.toBe(first)
    expect(owner.mode()).toBe('read-only')
  })

  it('loosening the mode keeps live sessions', () => {
    const { owner, built } = harness('read-only')
    const first = owner.backend()
    expect(owner.setMode('danger-full-access')).toEqual({ killed: 0 })
    expect(built[0]?.kills).toBe(0)
    expect(owner.backend()).toBe(first)
  })

  it('a new command after setMode is wrapped with the new mode', () => {
    const { owner, built, wraps } = harness('danger-full-access')
    owner.setMode('read-only')
    built[1]?.options.wrapCommand?.('bash -i', '/w')
    expect(wraps).toEqual(['read-only'])
  })

  it('rotate kills and replaces the backend; shutdown kills it', () => {
    const { owner, built } = harness('read-only')
    owner.rotate()
    expect(built[0]?.kills).toBe(1)
    expect(built).toHaveLength(2)
    owner.shutdown()
    expect(built[1]?.kills).toBe(1)
  })

  it('maxSessions 0 throws PtyOwnerConfigError', () => {
    let error: unknown
    try {
      createPtyOwner<Mode>({ mode: 'read-only', maxSessions: 0, wrapFor: () => () => null })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(PtyOwnerConfigError)
    expect((error as PtyOwnerConfigError).code).toBe('pty_owner_invalid')
  })

  it('a mode outside order throws PtyOwnerConfigError', () => {
    const { owner } = harness('read-only')
    let error: unknown
    try {
      owner.setMode('bogus' as Mode)
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(PtyOwnerConfigError)
    expect((error as PtyOwnerConfigError).code).toBe('pty_owner_invalid')
    expect(owner.mode()).toBe('read-only')
  })
})
