import type { GatewayHook, HookDecision, MessageEvent, PlatformName } from '@theokit/gateway'
import { describe, expect, it, vi } from 'vitest'

import { createOwnerPolicyHook } from '../src/authorization/owner-policy-hook.js'
import type { ApprovalResult, PairingStore } from '../src/authorization/pairing-store.js'
import type { AuthorizationPolicy, DmPolicy } from '../src/authorization/policy.js'
import { messageEvent } from './fakes.js'

// The decisions of the owner policy hook, called directly with in-memory collaborators: no gateway
// runner, no store on disk, no timer. The runner-level layer is authorization-hook.test.ts.

const HOUR_MS = 3_600_000
const OWNER_ID = 'owner-1'
const REFUSAL = 'Not for you.'
const PAIRED = 'Paired.'
const INVALID_CODE = 'That code is not valid or has expired.'
const NOT_SAVED = 'The pairing could not be saved.'
const PAIRING_OFF = 'Pairing is off: set THEOCLAW_STATE_DIR to keep pairings.'

interface FakeStoreOptions {
  readonly paired?: readonly string[]
  readonly approve?: ApprovalResult
  readonly issue?: string | Error
  readonly isPairedThrows?: boolean | Error
  readonly approveThrows?: Error
}

interface FakeStore extends PairingStore {
  /** Every call the hook made, as `method:args`. */
  readonly calls: string[]
}

function fakeStore(options: FakeStoreOptions = {}): FakeStore {
  const calls: string[] = []
  return {
    calls,
    issue(platform, senderId) {
      calls.push(`issue:${platform}:${senderId}`)
      if (options.issue instanceof Error) throw options.issue
      return options.issue ?? '123456'
    },
    approve(code) {
      calls.push(`approve:${code}`)
      if (options.approveThrows !== undefined) return Promise.reject(options.approveThrows)
      return Promise.resolve(options.approve ?? { ok: false, reason: 'unknown_or_expired' })
    },
    isPaired(platform, senderId) {
      calls.push(`isPaired:${platform}:${senderId}`)
      if (options.isPairedThrows instanceof Error) throw options.isPairedThrows
      if (options.isPairedThrows === true) throw new Error('the store broke')
      return (options.paired ?? []).includes(`${platform}:${senderId}`)
    },
  }
}

/** Built literally, so it can reach `pairing` with no store, which `parseAuthorizationPolicy` refuses. */
function policy(overrides: Partial<AuthorizationPolicy> = {}): AuthorizationPolicy {
  return {
    owners: new Set([`telegram:${OWNER_ID}`]),
    dmPolicy: 'pairing',
    groupActivation: 'mention',
    refusalText: REFUSAL,
    stateDir: undefined,
    broadcastGroups: [],
    ...overrides,
  }
}

function inGroup(event: MessageEvent): MessageEvent {
  return { ...event, channel: { id: 'group-1', type: 'group' } } as MessageEvent
}

async function decide(hook: GatewayHook, event: MessageEvent): Promise<HookDecision | undefined> {
  const preInbound = hook.pre_inbound
  if (preInbound === undefined) throw new Error('the owner policy hook declares no pre_inbound')
  return (await preInbound({ event })) ?? undefined
}

interface Harness {
  readonly hook: GatewayHook
  readonly lines: string[]
  /** Moves the injected clock. */
  at(ms: number): void
}

function harness(options: { policy?: AuthorizationPolicy; pairing?: PairingStore; write?: (line: string) => void } = {}): Harness {
  let now = 0
  const lines: string[] = []
  const hook = createOwnerPolicyHook({
    policy: options.policy ?? policy(),
    ...(options.pairing === undefined ? {} : { pairing: options.pairing }),
    clock: () => now,
    write: options.write ?? ((line) => lines.push(line)),
  })
  return {
    hook,
    lines,
    at(ms) {
      now = ms
    },
  }
}

function pairingMessage(code: string): string {
  return `Pairing code: ${code}. Ask the owner to send /approve ${code} in a direct message.`
}

describe('owner policy hook: who is let through', () => {
  it("allows an owner's DM", async () => {
    const { hook } = harness({ pairing: fakeStore() })
    expect(await decide(hook, messageEvent('telegram', 'hi', OWNER_ID))).toBeUndefined()
  })

  it("allows a paired sender's DM on an authenticated platform", async () => {
    const { hook } = harness({ pairing: fakeStore({ paired: ['telegram:friend'] }) })
    expect(await decide(hook, messageEvent('telegram', 'hi', 'friend'))).toBeUndefined()
  })

  it("allows a stranger's DM under open", async () => {
    const { hook } = harness({ policy: policy({ dmPolicy: 'open' }) })
    expect(await decide(hook, messageEvent('telegram', 'hi', 'stranger'))).toBeUndefined()
  })

  it("allows a stranger's DM from an unauthenticated platform under open", async () => {
    const { hook } = harness({ policy: policy({ dmPolicy: 'open' }) })
    expect(await decide(hook, messageEvent('email', 'hi', 'someone@example.com'))).toBeUndefined()
  })
})

describe('owner policy hook: how a stranger is refused', () => {
  it("answers a stranger's DM under pairing with the code the store issued", async () => {
    const store = fakeStore({ issue: '654321' })
    const { hook } = harness({ pairing: store })
    expect(await decide(hook, messageEvent('telegram', 'hi', 'stranger'))).toEqual({
      block: true,
      message: pairingMessage('654321'),
    })
    expect(store.calls).toContain('issue:telegram:stranger')
  })

  it("keeps a stranger's second DM within one hour silent", async () => {
    const { hook, at } = harness({ pairing: fakeStore() })
    await decide(hook, messageEvent('telegram', 'hi', 'stranger'))
    at(60_000)
    expect(await decide(hook, messageEvent('telegram', 'again', 'stranger'))).toEqual({ block: true })
  })

  it("answers a stranger's DM under allowlist with refusalText", async () => {
    const { hook } = harness({ policy: policy({ dmPolicy: 'allowlist' }) })
    expect(await decide(hook, messageEvent('telegram', 'hi', 'stranger'))).toEqual({ block: true, message: REFUSAL })
  })

  it("keeps a stranger's DM under disabled silent", async () => {
    const { hook } = harness({ policy: policy({ dmPolicy: 'disabled' }) })
    expect(await decide(hook, messageEvent('telegram', 'hi', 'stranger'))).toEqual({ block: true })
  })

  it.each<DmPolicy>(['pairing', 'allowlist', 'open', 'disabled'])('keeps a stranger in a group silent under %s', async (dmPolicy) => {
    const store = fakeStore()
    const { hook } = harness({ policy: policy({ dmPolicy }), pairing: store })
    expect(await decide(hook, inGroup(messageEvent('telegram', 'hi', 'stranger')))).toEqual({ block: true })
    expect(store.calls.filter((call) => call.startsWith('issue:'))).toEqual([])
  })

  it("answers a stranger's DM under pairing with no store with refusalText", async () => {
    const { hook } = harness({ policy: policy({ dmPolicy: 'pairing' }) })
    expect(await decide(hook, messageEvent('telegram', 'hi', 'stranger'))).toEqual({ block: true, message: REFUSAL })
  })

  it('keeps a DM from an unauthenticated platform silent even under allowlist', async () => {
    const { hook } = harness({ policy: policy({ dmPolicy: 'allowlist' }) })
    expect(await decide(hook, messageEvent('email', 'hi', 'someone@example.com'))).toEqual({ block: true })
  })

  it('refuses a sender the store reports paired when the platform is unauthenticated', async () => {
    const store = fakeStore({ paired: ['sms:+15550100'] })
    const { hook } = harness({ pairing: store })
    expect(await decide(hook, messageEvent('sms', 'hi', '+15550100'))).toEqual({ block: true })
    expect(store.calls.filter((call) => call.startsWith('issue:'))).toEqual([])
  })

  it('keeps a DM from a platform the module does not know silent and issues no code', async () => {
    const store = fakeStore()
    const { hook } = harness({ pairing: store })
    const unknown = messageEvent('telegram', 'hi', 'stranger')
    const event = { ...unknown, platform: 'carrier-pigeon' as PlatformName } as MessageEvent
    expect(await decide(hook, event)).toEqual({ block: true })
    expect(store.calls.filter((call) => call.startsWith('issue:'))).toEqual([])
  })

  it('answers one sender id once on discord after refusing it on telegram', async () => {
    const { hook } = harness({ policy: policy({ dmPolicy: 'allowlist' }) })
    await decide(hook, messageEvent('telegram', 'hi', 'stranger'))
    expect(await decide(hook, messageEvent('discord', 'hi', 'stranger'))).toEqual({ block: true, message: REFUSAL })
  })
})

describe('owner policy hook: the refusal memory', () => {
  it('keeps a stranger refused at t silent at t + 3599999', async () => {
    const { hook, at } = harness({ policy: policy({ dmPolicy: 'allowlist' }) })
    at(1_000)
    await decide(hook, messageEvent('telegram', 'hi', 'stranger'))
    at(1_000 + HOUR_MS - 1)
    expect(await decide(hook, messageEvent('telegram', 'hi', 'stranger'))).toEqual({ block: true })
  })

  it('answers a stranger refused at t again at t + 3600000', async () => {
    const { hook, at } = harness({ policy: policy({ dmPolicy: 'allowlist' }) })
    at(1_000)
    await decide(hook, messageEvent('telegram', 'hi', 'stranger'))
    at(1_000 + HOUR_MS)
    expect(await decide(hook, messageEvent('telegram', 'hi', 'stranger'))).toEqual({ block: true, message: REFUSAL })
  })
})

describe("owner policy hook: the owner's /approve", () => {
  it('blocks /approve with the pairing-off message when there is no store', async () => {
    const { hook } = harness()
    expect(await decide(hook, messageEvent('telegram', '/approve 123456', OWNER_ID))).toEqual({
      block: true,
      message: PAIRING_OFF,
    })
  })

  it('blocks /approve with a malformed code with the invalid-code message', async () => {
    const store = fakeStore()
    const { hook } = harness({ pairing: store })
    expect(await decide(hook, messageEvent('telegram', '/approve 12ab', OWNER_ID))).toEqual({
      block: true,
      message: INVALID_CODE,
    })
    expect(store.calls.filter((call) => call.startsWith('approve:'))).toEqual([])
  })

  it.each(['12345', '1234567'])('blocks /approve %s, a code of the wrong length, with the invalid-code message', async (code) => {
    const store = fakeStore({ approve: { ok: true, platform: 'telegram', senderId: 'friend' } })
    const { hook } = harness({ pairing: store })
    expect(await decide(hook, messageEvent('telegram', `/approve ${code}`, OWNER_ID))).toEqual({
      block: true,
      message: INVALID_CODE,
    })
    expect(store.calls.filter((call) => call.startsWith('approve:'))).toEqual([])
  })

  it('blocks a bare /approve with the invalid-code message', async () => {
    const store = fakeStore()
    const { hook } = harness({ pairing: store })
    expect(await decide(hook, messageEvent('telegram', '/approve', OWNER_ID))).toEqual({
      block: true,
      message: INVALID_CODE,
    })
    expect(store.calls.filter((call) => call.startsWith('approve:'))).toEqual([])
  })

  it('blocks /approve the store accepts with Paired.', async () => {
    const store = fakeStore({ approve: { ok: true, platform: 'telegram', senderId: 'friend' } })
    const { hook } = harness({ pairing: store })
    expect(await decide(hook, messageEvent('telegram', '/approve 123456', OWNER_ID))).toEqual({
      block: true,
      message: PAIRED,
    })
  })

  it('blocks /approve the store refuses as unknown_or_expired with the invalid-code message', async () => {
    const { hook } = harness({ pairing: fakeStore({ approve: { ok: false, reason: 'unknown_or_expired' } }) })
    expect(await decide(hook, messageEvent('telegram', '/approve 123456', OWNER_ID))).toEqual({
      block: true,
      message: INVALID_CODE,
    })
  })

  it('blocks /approve the store cannot save with the not-saved message', async () => {
    const { hook } = harness({ pairing: fakeStore({ approve: { ok: false, reason: 'write_failed' } }) })
    expect(await decide(hook, messageEvent('telegram', '/approve 123456', OWNER_ID))).toEqual({
      block: true,
      message: NOT_SAVED,
    })
  })

  it('allows /approver, which is not the approve command', async () => {
    const store = fakeStore()
    const { hook } = harness({ pairing: store })
    expect(await decide(hook, messageEvent('telegram', '/approver 123456', OWNER_ID))).toBeUndefined()
    expect(store.calls.filter((call) => call.startsWith('approve:'))).toEqual([])
  })

  it("allows an owner's /approve in a group instead of routing it to approval", async () => {
    const store = fakeStore()
    const { hook } = harness({ pairing: store })
    expect(await decide(hook, inGroup(messageEvent('telegram', '/approve 123456', OWNER_ID)))).toBeUndefined()
    expect(store.calls.filter((call) => call.startsWith('approve:'))).toEqual([])
  })

  it('passes the code of an /approve with surrounding spaces to the store', async () => {
    const store = fakeStore({ approve: { ok: true, platform: 'telegram', senderId: 'friend' } })
    const { hook } = harness({ pairing: store })
    expect(await decide(hook, messageEvent('telegram', '  /approve 123456  ', OWNER_ID))).toEqual({
      block: true,
      message: PAIRED,
    })
    expect(store.calls).toContain('approve:123456')
  })
})

describe('owner policy hook: a failure is a silent block', () => {
  it('blocks silently with one log line when issue() throws', async () => {
    const { hook, lines } = harness({ pairing: fakeStore({ issue: new Error('no code space left') }) })
    expect(await decide(hook, messageEvent('telegram', 'hi', 'stranger'))).toEqual({ block: true })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('no code space left')
  })

  it('does not silence a sender whose code issue() failed to issue', async () => {
    const store = fakeStore({ issue: new Error('no code space left') })
    const { hook } = harness({ pairing: store })
    await decide(hook, messageEvent('telegram', 'hi', 'stranger'))
    await decide(hook, messageEvent('telegram', 'again', 'stranger'))
    // A recorded refusal would have answered the second DM without asking the store for a code.
    expect(store.calls.filter((call) => call.startsWith('issue:'))).toHaveLength(2)
  })

  it('blocks silently with one log line naming the platform when isPaired throws', async () => {
    const { hook, lines } = harness({ pairing: fakeStore({ isPairedThrows: true }) })
    expect(await decide(hook, messageEvent('telegram', 'hi', 'stranger'))).toEqual({ block: true })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('telegram')
    expect(lines[0]).toContain('the store broke')
    expect(lines[0]).not.toContain('stranger')
  })

  it("blocks an owner's DM silently when isPaired throws, as the store is read before the owner is let through", async () => {
    const { hook, lines } = harness({ pairing: fakeStore({ isPairedThrows: true }) })
    expect(await decide(hook, messageEvent('telegram', 'hi', OWNER_ID))).toEqual({ block: true })
    expect(lines).toHaveLength(1)
  })

  it("blocks an owner's /approve silently when the store's approve() rejects", async () => {
    const { hook, lines } = harness({ pairing: fakeStore({ approveThrows: new Error('the disk is gone') }) })
    expect(await decide(hook, messageEvent('telegram', '/approve 123456', OWNER_ID))).toEqual({ block: true })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('the disk is gone')
  })

  it('redacts a secret carried by the error message from the log line', async () => {
    const token = 'abcdefghijklmnopqrstuvwxyz0123456789'
    const { hook, lines } = harness({ pairing: fakeStore({ isPairedThrows: new Error(`Bearer ${token} refused`) }) })
    expect(await decide(hook, messageEvent('telegram', 'hi', 'stranger'))).toEqual({ block: true })
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain(token)
  })

  it('blocks silently and writes the stderr fallback line when write throws', async () => {
    const { hook } = harness({
      pairing: fakeStore({ isPairedThrows: true }),
      write: () => {
        throw new Error('the log sink is gone')
      },
    })
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect(await decide(hook, messageEvent('telegram', 'hi', 'stranger'))).toEqual({ block: true })
      expect(stderr).toHaveBeenCalledWith(
        'theoclaw-owner-policy: telegram: the hook failed and its log line could not be written\n',
      )
    } finally {
      stderr.mockRestore()
    }
  })
})
