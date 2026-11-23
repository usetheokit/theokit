import { createAccessPolicyHook } from '@theokit/gateway'
import type { MessageEvent, PairingStore } from '@theokit/gateway'
import { describe, expect, it } from 'vitest'

import { createOwnerPolicyHook } from '../src/authorization/owner-policy-hook.js'
import type { AuthorizationPolicy } from '../src/authorization/policy.js'

/** Why the owner policy and pairing store stay in TheoClaw: the gateway's hook words replies differently. */

const policy: AuthorizationPolicy = {
  owners: new Set(['telegram:owner']),
  dmPolicy: 'pairing',
  groupActivation: 'mention',
  refusalText: 'owner only',
  stateDir: undefined,
  broadcastGroups: [],
  allowed: new Set(),
}

const event = (text: string, sender: string): MessageEvent =>
  ({ id: 'm', platform: 'telegram', sender: { id: sender }, channel: { id: 'c', type: 'dm' }, text, receivedAt: 0 }) as unknown as MessageEvent

function store(approve: Awaited<ReturnType<PairingStore['approve']>>): PairingStore {
  return { issue: () => '123456', approve: async () => approve, isPaired: () => false }
}

async function replies(approve: Awaited<ReturnType<PairingStore['approve']>>, text: string, sender: string) {
  const pairing = store(approve)
  const mine = createOwnerPolicyHook({ policy, pairing, write: () => undefined })
  const theirs = createAccessPolicyHook({ owners: new Set(['telegram:owner']), dm: 'pairing', pairing, isAuthenticated: () => true, write: () => undefined })
  const ask = (hook: typeof mine) => hook.pre_inbound!({ event: event(text, sender) } as never) as Promise<{ message?: string }>
  return { mine: (await ask(mine)).message, theirs: (await ask(theirs)).message }
}

describe('parity with the gateway access policy', () => {
  it('words the pairing code reply differently', async () => {
    const { mine, theirs } = await replies({ ok: false, reason: 'unknown_or_expired' }, 'hello', 'stranger')
    expect(mine).toBe('Pairing code: 123456. Ask the owner to send /approve 123456 in a direct message.')
    expect(theirs).toBe('Your pairing code is 123456. Ask the owner to send /approve 123456.')
  })

  it('words an invalid or expired code differently', async () => {
    const { mine, theirs } = await replies({ ok: false, reason: 'unknown_or_expired' }, '/approve 123456', 'owner')
    expect(mine).toBe('That code is not valid or has expired.')
    expect(theirs).toBe('Unknown or expired code.')
  })

  it('words a failed save differently', async () => {
    const { mine, theirs } = await replies({ ok: false, reason: 'write_failed' }, '/approve 123456', 'owner')
    expect(mine).toBe('The pairing could not be saved.')
    expect(theirs).not.toBe(mine)
  })

  it('answers the same for a successful approval', async () => {
    const { mine, theirs } = await replies({ ok: true, platform: 'telegram', senderId: 'x' }, '/approve 123456', 'owner')
    expect(mine).toBe(theirs)
  })
})
