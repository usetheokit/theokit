/**
 * #2798 — `useConsent` end to end over a mocked config/hook store: approval, refusal, a failed
 * persist, and the trust rollback each change what the hook exposes.
 */
import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  hooks: [] as { fingerprint: string; status: string }[],
  approveHook: vi.fn<(cwd: string, spec: unknown) => Promise<void>>(),
  classifyCalls: 0,
  posture: 'untrusted',
}))

vi.mock('@theocode/agent/config', () => ({
  resolveEffectiveConfig: () => ({ hooks: [] }),
  resolveTrustPosture: () => ({ level: store.posture }),
}))
vi.mock('@theocode/agent/hooks', () => ({
  parseHooks: () => [],
  classifyHooks: () => {
    store.classifyCalls += 1
    return store.hooks.map((h) => ({ ...h, spec: { event: 'e', command: h.fingerprint } }))
  },
  approveHook: store.approveHook,
}))

import { useConsent, type Consent } from '../../src/consent/use-consent.js'

let current: Consent
function Probe({ cwd }: { cwd: string }) {
  const consent = useConsent(cwd)
  useEffect(() => {
    current = consent
  })
  current = consent
  return (
    <Text>{`${consent.trusted}|${consent.hooksReviewed}|${consent.pendingHooks.map((h) => h.fingerprint).join(',')}`}</Text>
  )
}

const flush = () => new Promise((r) => setTimeout(r, 30))
const mount = () => render(<Probe cwd="/proj" />)
const act = async (fn: () => unknown) => {
  await fn()
  await flush()
}

beforeEach(() => {
  store.hooks = [
    { fingerprint: 'a', status: 'new' },
    { fingerprint: 'b', status: 'new' },
  ]
  store.posture = 'untrusted'
  store.classifyCalls = 0
  store.approveHook.mockReset()
  store.approveHook.mockResolvedValue(undefined)
})

describe('useConsent', () => {
  it('test_starts_with_the_resolved_posture_and_every_untrusted_hook_pending', () => {
    store.posture = 'trusted'
    const { lastFrame } = mount()
    expect(lastFrame()).toBe('true|false|a,b')
  })

  it('test_refusals_accumulate_and_drop_each_hook_from_pending', async () => {
    const { lastFrame } = mount()
    await act(() => current.refuseHook('a'))
    expect(lastFrame()).toBe('false|false|b')
    await act(() => current.refuseHook('b'))
    expect(lastFrame()).toBe('false|false|')
  })

  it('test_a_persisted_approval_recomputes_pending_from_the_store', async () => {
    const { lastFrame } = mount()
    store.approveHook.mockImplementation(() => {
      store.hooks = store.hooks.filter((h) => h.fingerprint !== 'a')
      return Promise.resolve()
    })
    await act(() => current.approveHookConsent({ command: 'a' }))
    expect(store.approveHook).toHaveBeenCalledWith('/proj', { command: 'a' })
    expect(lastFrame()).toBe('false|false|b')
  })

  it('test_a_failed_persist_rejects_and_leaves_pending_and_epoch_alone', async () => {
    const { lastFrame } = mount()
    const before = store.classifyCalls
    store.approveHook.mockRejectedValue(new Error('EROFS'))
    await expect(current.approveHookConsent({ command: 'a' })).rejects.toThrow('EROFS')
    await flush()
    expect(lastFrame()).toBe('false|false|a,b')
    expect(store.classifyCalls, 'a failed write must not trigger a re-read').toBe(before)
  })

  it('test_trust_rereads_pending_hooks_and_distrust_rolls_the_flag_back_without_a_re_read', async () => {
    const { lastFrame } = mount()
    const before = store.classifyCalls
    store.hooks = [{ fingerprint: 'c', status: 'new' }]
    await act(() => current.trust())
    expect(lastFrame()).toBe('true|false|c')
    expect(store.classifyCalls).toBe(before + 1)

    await act(() => current.distrust())
    expect(lastFrame()).toBe('false|false|c')
    expect(store.classifyCalls, 'distrust writes nothing, so nothing is re-read').toBe(before + 1)
  })

  it('test_mark_reviewed_closes_the_gate_and_keeps_trust', async () => {
    store.posture = 'trusted'
    const { lastFrame } = mount()
    await act(() => current.markReviewed())
    expect(lastFrame()).toBe('true|true|a,b')
  })

  it('test_a_throwing_store_reports_and_leaves_nothing_pending', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    store.hooks = new Proxy([], {
      get() {
        throw new Error('boom')
      },
    }) as never
    const { lastFrame } = mount()
    expect(lastFrame()).toBe('false|false|')
    expect(write).toHaveBeenCalledWith(expect.stringContaining('consent check failed'))
    write.mockRestore()
  })
})
