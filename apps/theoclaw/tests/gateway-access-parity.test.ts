import { createAccessPolicyHook } from '@theokit/gateway'
import type { MessageEvent, PairingStore } from '@theokit/gateway'
import { describe, expect, it } from 'vitest'

import { createOwnerPolicyHook } from '../src/authorization/owner-policy-hook.js'
import type { AuthorizationPolicy } from '../src/authorization/policy.js'

/** The owner policy hook wraps the gateway's hook: the replies are TheoClaw's own wording, passed as `messages`. */

const policy: AuthorizationPolicy = {
  owners: new Set(['telegram:owner']),
  dmPolicy: 'pairing',
  groupActivation: 'mention',
  refusalText: 'owner only',
  stateDir: undefined,
  broadcastGroups: [],
  allowed: new Set(),
}

const TEXTS = {
  pairingCode: (code: string) => `Pairing code: ${code}. Ask the owner to send /approve ${code} in a direct message.`,
  invalidCode: 'That code is not valid or has expired.',
  failedSave: 'The pairing could not be saved.',
  paired: 'Paired.',
}

const event = (text: string, sender: string): MessageEvent =>
  ({ id: 'm', platform: 'telegram', sender: { id: sender }, channel: { id: 'c', type: 'dm' }, text, receivedAt: 0 }) as unknown as MessageEvent

function store(approve: Awaited<ReturnType<PairingStore['approve']>>): PairingStore {
  return { issue: () => '123456', approve: async () => approve, isPaired: () => false }
}

async function replies(approve: Awaited<ReturnType<PairingStore['approve']>>, text: string, sender: string) {
  const pairing = store(approve)
  const mine = createOwnerPolicyHook({ policy, pairing, write: () => undefined })
  const theirs = createAccessPolicyHook({ owners: new Set(['telegram:owner']), dm: 'pairing', pairing, isAuthenticated: () => true, write: () => undefined, messages: TEXTS })
  const ask = (hook: typeof mine) => hook.pre_inbound!({ event: event(text, sender) } as never) as Promise<{ message?: string }>
  return { mine: (await ask(mine)).message, theirs: (await ask(theirs)).message }
}

describe('parity with the gateway access policy', () => {
  it('words the pairing code reply the same', async () => {
    const { mine, theirs } = await replies({ ok: false, reason: 'unknown_or_expired' }, 'hello', 'stranger')
    expect(mine).toBe('Pairing code: 123456. Ask the owner to send /approve 123456 in a direct message.')
    expect(theirs).toBe(mine)
  })

  it('words an invalid or expired code the same', async () => {
    const { mine, theirs } = await replies({ ok: false, reason: 'unknown_or_expired' }, '/approve 123456', 'owner')
    expect(mine).toBe('That code is not valid or has expired.')
    expect(theirs).toBe(mine)
  })

  it('words a failed save the same', async () => {
    const { mine, theirs } = await replies({ ok: false, reason: 'write_failed' }, '/approve 123456', 'owner')
    expect(mine).toBe('The pairing could not be saved.')
    expect(theirs).toBe(mine)
  })

  it('answers the same for a successful approval', async () => {
    const { mine, theirs } = await replies({ ok: true, platform: 'telegram', senderId: 'x' }, '/approve 123456', 'owner')
    expect(mine).toBe(theirs)
  })

  it('keeps TheoClaw behavior where the gateway differs: a bare /approve in a DM is refused, in a group it is not a pairing', async () => {
    const pairing = store({ ok: true, platform: 'telegram', senderId: 'x' })
    const mine = createOwnerPolicyHook({ policy, pairing, write: () => undefined })
    const theirs = createAccessPolicyHook({ owners: new Set(['telegram:owner']), dm: 'pairing', pairing, isAuthenticated: () => true, messages: TEXTS })
    const ask = (hook: typeof mine, text: string, type: 'dm' | 'group') =>
      hook.pre_inbound!({ event: { ...event(text, 'owner'), channel: { id: 'c', type } } } as never) as Promise<{ block?: boolean; message?: string } | undefined>
    expect(await ask(theirs, '/approve', 'dm')).toBeUndefined()
    expect((await ask(mine, '/approve', 'dm'))?.message).toBe('That code is not valid or has expired.')
    expect((await ask(theirs, '/approve 123456', 'group'))?.message).toBe('Paired.')
    expect(await ask(mine, '/approve 123456', 'group')).toBeUndefined()
  })
})
