import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'ink-testing-library'
import { act } from 'react'

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
  render(<Probe />)
  return { get: () => current }
}

beforeEach(() => {
  m.trustDir.mockReset().mockResolvedValue(undefined)
  m.approveHook.mockReset().mockResolvedValue(undefined)
  m.level = 'untrusted'
  m.hooks = [classified]
})

describe('useConsent adapter', () => {
  it('approves a fingerprint by persisting the matching spec', async () => {
    const c = mount()
    await act(() => c.get().approveHook('fp1'))
    expect(m.approveHook).toHaveBeenCalledWith('/proj', spec)
  })

  it('keeps the hook pending and rejects when the persist fails (B-040)', async () => {
    m.approveHook.mockRejectedValue(new Error('disk full'))
    const c = mount()
    await act(async () => {
      await expect(c.get().approveHook('fp1')).rejects.toThrow('disk full')
    })
    expect(c.get().pendingHooks.map((h) => h.fingerprint)).toEqual(['fp1'])
  })

  it('rejects a fingerprint that is no longer pending without persisting', async () => {
    const c = mount()
    await act(async () => {
      await expect(c.get().approveHook('gone')).rejects.toThrow(/no longer pending/)
    })
    expect(m.approveHook).not.toHaveBeenCalled()
  })

  it('refusing a hook persists nothing and drops it from the pending list', async () => {
    const c = mount()
    act(() => c.get().refuseHook('fp1'))
    expect(m.approveHook).not.toHaveBeenCalled()
    expect(c.get().pendingHooks).toEqual([])
  })

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
})
