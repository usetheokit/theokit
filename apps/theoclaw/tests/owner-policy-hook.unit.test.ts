import type { MessageEvent, PlatformName } from '@theokit/gateway'
import { describe, expect, it } from 'vitest'

import { createOwnerPolicyHook } from '../src/authorization/owner-policy-hook.js'
import type { ApprovalResult, PairingStore } from '../src/authorization/pairing-store.js'
import type { AuthorizationPolicy, DmPolicy } from '../src/authorization/policy.js'

// No I/O: the clock, the log sink and the pairing store are all in-memory fakes.

const HOUR_MS = 3_600_000

function policy(dmPolicy: DmPolicy, owners: string[] = ['telegram:owner']): AuthorizationPolicy {
  return {
    owners: new Set(owners),
    dmPolicy,
    groupActivation: 'mention',
    refusalText: 'owner only',
    stateDir: undefined,
    broadcastGroups: [],
  }
}

function fakePairing(result: ApprovalResult = { ok: true, platform: 'telegram', senderId: 'x' }) {
  const paired = new Set<string>()
  const approved: string[] = []
  const store: PairingStore = {
    issue: () => '123456',
    approve: async (code) => {
      approved.push(code)
      return result
    },
    isPaired: (platform, id) => paired.has(`${platform}:${id}`),
  }
  return { store, paired, approved }
}

function event(text: string, id = 'stranger', platform: PlatformName = 'telegram', type = 'dm'): MessageEvent {
  return { id: 'm', platform, sender: { id }, channel: { id: 'c', type }, text, receivedAt: 0 } as unknown as MessageEvent
}

function build(dm: DmPolicy, pairing?: PairingStore, now = { t: 0 }, write: (l: string) => void = () => undefined) {
  const hook = createOwnerPolicyHook({ policy: policy(dm), ...(pairing ? { pairing } : {}), clock: () => now.t, write })
  const run = (e: MessageEvent) => hook.pre_inbound!({ event: e } as never) as Promise<unknown>
  return { run, now }
}

describe('createOwnerPolicyHook (no I/O)', () => {
  it('lets the owner through', async () => {
    expect(await build('allowlist').run(event('hi', 'owner'))).toBeUndefined()
  })

  it('lets a paired sender through', async () => {
    const p = fakePairing()
    p.paired.add('telegram:friend')
    expect(await build('pairing', p.store).run(event('hi', 'friend'))).toBeUndefined()
  })

  it('lets anyone through a DM under open', async () => {
    expect(await build('open').run(event('hi'))).toBeUndefined()
  })

  it('refuses a stranger with the refusal text under allowlist, once per hour', async () => {
    const { run, now } = build('allowlist')
    expect(await run(event('hi'))).toEqual({ block: true, message: 'owner only' })
    expect(await run(event('hi'))).toEqual({ block: true })
    now.t = HOUR_MS
    expect(await run(event('hi'))).toEqual({ block: true, message: 'owner only' })
  })

  it('answers a stranger with a pairing code under pairing', async () => {
    const res = (await build('pairing', fakePairing().store).run(event('hi'))) as { message: string }
    expect(res.message).toContain('123456')
  })

  it('stays silent under disabled', async () => {
    expect(await build('disabled').run(event('hi'))).toEqual({ block: true })
  })

  it('never answers a group stranger, and lets a group owner through', async () => {
    const { run } = build('pairing', fakePairing().store)
    expect(await run(event('hi', 'stranger', 'telegram', 'group'))).toEqual({ block: true })
    expect(await run(event('hi', 'owner', 'telegram', 'group'))).toBeUndefined()
  })

  it('does not admit or answer an unauthenticated platform sender', async () => {
    const hook = createOwnerPolicyHook({ policy: policy('pairing', ['email:o@x.io']), pairing: fakePairing().store, write: () => undefined })
    const res = await hook.pre_inbound!({ event: event('hi', 'o@x.io', 'email') } as never)
    expect(res).toEqual({ block: true })
  })

  it('handles /approve from the owner in a DM', async () => {
    const p = fakePairing()
    const { run } = build('pairing', p.store)
    expect(await run(event('/approve 123456', 'owner'))).toEqual({ block: true, message: 'Paired.' })
    expect(p.approved).toEqual(['123456'])
    expect(await run(event('/approve nope', 'owner'))).toEqual({ block: true, message: 'That code is not valid or has expired.' })
  })

  it('reports a failed save and an unknown code, and pairing off', async () => {
    const failed = build('pairing', fakePairing({ ok: false, reason: 'write_failed' }).store)
    expect(await failed.run(event('/approve 123456', 'owner'))).toEqual({ block: true, message: 'The pairing could not be saved.' })
    const unknown = build('pairing', fakePairing({ ok: false, reason: 'unknown_or_expired' }).store)
    expect(await unknown.run(event('/approve 123456', 'owner'))).toEqual({ block: true, message: 'That code is not valid or has expired.' })
    expect(await build('allowlist').run(event('/approve 123456', 'owner'))).toEqual({
      block: true,
      message: 'Pairing is off: set THEOCLAW_STATE_DIR to keep pairings.',
    })
  })

  it('does not let a stranger approve', async () => {
    const p = fakePairing()
    const res = await build('pairing', p.store).run(event('/approve 123456'))
    expect(p.approved).toEqual([])
    expect((res as { message: string }).message).toContain('Pairing code')
  })

  it('blocks silently and logs a redacted line when the store throws', async () => {
    const lines: string[] = []
    const store: PairingStore = { issue: () => { throw new Error('disk full') }, approve: async () => ({ ok: false, reason: 'write_failed' }), isPaired: () => false }
    const { run } = build('pairing', store, { t: 0 }, (l) => void lines.push(l))
    expect(await run(event('hi'))).toEqual({ block: true })
    expect(lines).toEqual(['theoclaw-owner-policy: telegram: Error: disk full'])
  })

  it('does not admit a paired sender on an unauthenticated platform, and admits one in a group', async () => {
    const p = fakePairing()
    p.paired.add('email:friend')
    p.paired.add('telegram:friend')
    const { run } = build('pairing', p.store)
    expect(await run(event('hi', 'friend', 'email'))).toEqual({ block: true })
    expect(await run(event('hi', 'friend', 'telegram', 'group'))).toBeUndefined()
  })
})
