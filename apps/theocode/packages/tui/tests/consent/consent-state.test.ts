/**
 * Trust state and rollback when persisting trust fails. Formerly tested the app-local reducer.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'ink-testing-library'
import { act, createElement } from 'react'

const m = vi.hoisted(() => ({
  trustDir: vi.fn(),
  approveHook: vi.fn(),
  level: 'untrusted',
  hooks: [] as Array<Record<string, unknown>>,
}))

vi.mock('@theocode/agent/config', () => ({
  resolveEffectiveConfig: () => ({ hooks: [] }),
  resolveTrustPosture: () => ({ level: m.level }),
  trustDir: m.trustDir,
}))
vi.mock('@theocode/agent/hooks', () => ({
  parseHooks: () => [],
  classifyHooks: () => m.hooks,
  approveHook: m.approveHook,
}))

import { useConsent, type Consent } from '../../src/consent/use-consent.js'

const spec = { event: 'PreToolUse', command: 'echo hi' }
const classified = { spec, fingerprint: 'fp1', status: 'new' }

function mount(): { get: () => Consent } {
  let current!: Consent
  function Probe(): null {
    current = useConsent('/proj')
    return null
  }
  render(createElement(Probe))
  return { get: () => current }
}

beforeEach(() => {
  m.trustDir.mockReset().mockResolvedValue(undefined)
  m.approveHook.mockReset().mockResolvedValue(undefined)
  m.level = 'untrusted'
  m.hooks = [classified]
})

describe('trust state through the framework consent adapter', () => {
  it('trust persists via trustDir and flips trusted', async () => {
    const c = mount()
    expect(c.get().trusted).toBe(false)
    await act(() => c.get().trust())
    expect(m.trustDir).toHaveBeenCalledWith('/proj')
    expect(c.get().trusted).toBe(true)
  })

  it('rolls trust back and rethrows when persisting trust fails', async () => {
    m.trustDir.mockRejectedValue(new Error('read-only'))
    const c = mount()
    await act(async () => {
      await expect(c.get().trust()).rejects.toThrow('read-only')
    })
    expect(c.get().trusted).toBe(false)
  })

  it('starts trusted when the directory is already trusted', () => {
    m.level = 'trusted'
    expect(mount().get().trusted).toBe(true)
  })

  it('does not persist trust again for a directory that is already trusted', () => {
    m.level = 'trusted'
    mount()
    expect(m.trustDir).not.toHaveBeenCalled()
  })

  it('allows trust to be retried after a persistence failure', async () => {
    m.trustDir.mockRejectedValueOnce(new Error('read-only'))
    const c = mount()
    await act(async () => {
      await expect(c.get().trust()).rejects.toThrow('read-only')
    })
    await act(() => c.get().trust())
    expect(m.trustDir).toHaveBeenCalledTimes(2)
    expect(c.get().trusted).toBe(true)
  })
})
