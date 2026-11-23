/**
 * B-040 — a failed hook approval leaves the gate open and says so. Formerly tested the app-local
 * `applyHookDecision`; now exercises the same behaviour through `useWorkspaceConsent`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'ink-testing-library'
import { act, createElement } from 'react'

const m = vi.hoisted(() => ({
  trustDir: vi.fn(),
  approveHook: vi.fn(),
  level: 'untrusted',
  hooks: [] as Array<Record<string, unknown>>,
  approved: new Set<string>(),
}))

vi.mock('@theocode/agent/config', () => ({
  resolveEffectiveConfig: () => ({ hooks: [] }),
  resolveTrustPosture: () => ({ level: m.level }),
  trustDir: m.trustDir,
}))
vi.mock('@theocode/agent/hooks', () => ({
  parseHooks: () => [],
  classifyHooks: () => m.hooks.filter((h) => !m.approved.has(h.fingerprint as string)),
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
  m.approved.clear()
  m.approveHook.mockReset().mockImplementation(async (_cwd: string, sp: unknown) => {
    for (const h of m.hooks) if (h.spec === sp) m.approved.add(h.fingerprint as string)
  })
  m.level = 'untrusted'
  m.hooks = [classified]
})

describe('hook decisions through the framework consent adapter', () => {
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

  it('drops an approved hook from the pending list', async () => {
    const c = mount()
    await act(() => c.get().approveHook('fp1'))
    expect(c.get().pendingHooks).toEqual([])
  })

  it('approves the spec of the matching fingerprint among several', async () => {
    const other = {
      spec: { event: 'PostToolUse', command: 'ls' },
      fingerprint: 'fp2',
      status: 'new',
    }
    m.hooks = [classified, other]
    const c = mount()
    await act(() => c.get().approveHook('fp2'))
    expect(m.approveHook).toHaveBeenCalledTimes(1)
    expect(m.approveHook).toHaveBeenCalledWith('/proj', other.spec)
  })

  it('refusing one hook leaves the others pending, and refusals accumulate', () => {
    const other = {
      spec: { event: 'PostToolUse', command: 'ls' },
      fingerprint: 'fp2',
      status: 'new',
    }
    m.hooks = [classified, other]
    const c = mount()
    act(() => c.get().refuseHook('fp1'))
    expect(c.get().pendingHooks.map((h) => h.fingerprint)).toEqual(['fp2'])
    act(() => c.get().refuseHook('fp2'))
    expect(c.get().pendingHooks).toEqual([])
    expect(m.approveHook).not.toHaveBeenCalled()
  })

  it('allows approval to be retried after a persistence failure', async () => {
    m.approveHook.mockRejectedValueOnce(new Error('disk full'))
    const c = mount()
    await act(async () => {
      await expect(c.get().approveHook('fp1')).rejects.toThrow('disk full')
    })
    await act(() => c.get().approveHook('fp1'))
    expect(m.approveHook).toHaveBeenCalledTimes(2)
    expect(c.get().pendingHooks).toEqual([])
  })

  it('maps a modified hook with its previous command', () => {
    m.hooks = [{ ...classified, status: 'modified', previousCommand: 'echo old' }]
    const c = mount()
    expect(c.get().pendingHooks[0]).toMatchObject({
      fingerprint: 'fp1',
      event: 'PreToolUse',
      command: 'echo hi',
      status: 'modified',
      previousCommand: 'echo old',
    })
  })
})
