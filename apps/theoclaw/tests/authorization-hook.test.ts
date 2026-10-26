import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { GatewayRunner } from '@theokit/gateway'
import type { MessageEvent, PlatformName } from '@theokit/gateway'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createOwnerPolicyHook } from '../src/authorization/owner-policy-hook.js'
import { createPairingStore } from '../src/authorization/pairing-store.js'
import type { PairingStore } from '../src/authorization/pairing-store.js'
import { parseAuthorizationPolicy } from '../src/authorization/policy.js'
import { FakeAdapter, messageEvent, waitFor } from './fakes.js'

const HOUR_MS = 3_600_000
const OWNER_ID = 'owner-1'

let dir: string
const runners: GatewayRunner[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theoclaw-hook-'))
})

afterEach(async () => {
  await Promise.all(runners.splice(0).map((runner) => runner.stop()))
  rmSync(dir, { recursive: true, force: true })
})

/** Dispatches still running: the runner's `@internal` `_inflightSize` test seam, absent from its types. */
function inflight(runner: GatewayRunner): number {
  return (runner as unknown as { readonly _inflightSize: number })._inflightSize
}

interface InstanceOptions {
  readonly env?: Readonly<Record<string, string>>
  readonly platform?: PlatformName
  readonly pairing?: PairingStore | null
  readonly clock?: () => number
}

/**
 * One runner over an in-memory adapter, carrying the hook, whose handler counts the messages that
 * reached it. `pairing: null` builds the hook without a store.
 */
async function instance(options: InstanceOptions = {}) {
  const platform = options.platform ?? 'telegram'
  const env = { THEOCLAW_OWNERS: `${platform}:${OWNER_ID}`, THEOCLAW_STATE_DIR: dir, ...options.env }
  const policy = parseAuthorizationPolicy(env)
  const pairing = options.pairing === null ? undefined : (options.pairing ?? createPairingStore({ dir }))
  const lines: string[] = []
  const hook = createOwnerPolicyHook({
    policy,
    ...(pairing === undefined ? {} : { pairing }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    write: (line) => void lines.push(line),
  })
  const adapter = new FakeAdapter(platform)
  const handled: MessageEvent[] = []
  const runner = new GatewayRunner({
    adapters: [adapter],
    handler: async (event) => void handled.push(event),
    hooks: [hook],
  })
  runners.push(runner)
  await runner.start()
  /** Deliver and wait until the runner has dispatched it: replied, handled, or stayed silent. */
  const send = async (event: MessageEvent): Promise<void> => {
    await adapter.deliver(event)
    await waitFor(() => inflight(runner) === 0, 2000, 'the dispatch to settle')
  }
  return { policy, pairing, adapter, handled, lines, send, replies: () => adapter.sent.map((sent) => sent.text) }
}

function inGroup(event: MessageEvent): MessageEvent {
  return { ...event, channel: { id: 'group-1', type: 'group' } } as MessageEvent
}

describe('createOwnerPolicyHook', () => {
  it("an unlisted sender's DM gets one pairing code and the handler runs 0 times", async () => {
    const app = await instance()
    await app.send(messageEvent('telegram', 'hello', 'stranger'))
    await app.send(messageEvent('telegram', 'hello again', 'stranger'))
    expect(app.replies()).toHaveLength(1)
    expect(app.replies()[0]).toMatch(/^Pairing code: \d{6}\. Ask the owner to send \/approve \d{6} in a direct message\.$/)
    expect(app.handled).toHaveLength(0)
  })

  it('an unlisted sender in a group gets no reply and the handler runs 0 times', async () => {
    const app = await instance()
    await app.send(inGroup(messageEvent('telegram', 'hello', 'stranger')))
    expect(app.replies()).toEqual([])
    expect(app.handled).toHaveLength(0)
  })

  it('disabled policy replies nothing', async () => {
    const app = await instance({ env: { THEOCLAW_DM_POLICY: 'disabled' } })
    await app.send(messageEvent('telegram', 'hello', 'stranger'))
    expect(app.replies()).toEqual([])
    expect(app.handled).toHaveLength(0)
  })

  it('allowlist policy replies the refusal text once', async () => {
    const app = await instance({ env: { THEOCLAW_DM_POLICY: 'allowlist' } })
    await app.send(messageEvent('telegram', 'hello', 'stranger'))
    await app.send(messageEvent('telegram', 'hello again', 'stranger'))
    expect(app.replies()).toEqual([app.policy.refusalText])
    expect(app.handled).toHaveLength(0)
  })

  it('open policy lets an unlisted DM through', async () => {
    const app = await instance({ env: { THEOCLAW_DM_POLICY: 'open' } })
    await app.send(messageEvent('telegram', 'hello', 'stranger'))
    expect(app.handled).toHaveLength(1)
    expect(app.replies()).toEqual([])
  })

  it('runs without a pairing store under allowlist', async () => {
    const app = await instance({ env: { THEOCLAW_DM_POLICY: 'allowlist' }, pairing: null })
    await app.send(messageEvent('telegram', '/approve 123456', OWNER_ID))
    expect(app.replies()).toEqual(['Pairing is off: set THEOCLAW_STATE_DIR to keep pairings.'])
    expect(app.handled).toHaveLength(0)
  })

  it("an owner's message reaches the handler once", async () => {
    const app = await instance()
    await app.send(messageEvent('telegram', 'hello', OWNER_ID))
    expect(app.handled).toHaveLength(1)
    expect(app.replies()).toEqual([])
  })

  it('an owner /approve pairs the sender and never reaches the handler', async () => {
    const app = await instance()
    await app.send(messageEvent('telegram', 'hello', 'stranger'))
    const code = /\d{6}/.exec(app.replies()[0] ?? '')?.[0] ?? ''
    await app.send(messageEvent('telegram', `/approve ${code}`, OWNER_ID))
    expect(app.replies()[1]).toBe('Paired.')
    expect(app.handled).toHaveLength(0)
    await app.send(messageEvent('telegram', 'hello now', 'stranger'))
    expect(app.handled.map((event) => event.sender.id)).toEqual(['stranger'])
  })

  it('forgets a refusal after 3600 seconds', async () => {
    let now = 0
    const app = await instance({ env: { THEOCLAW_DM_POLICY: 'allowlist' }, clock: () => now })
    await app.send(messageEvent('telegram', 'hello', 'stranger'))
    await app.send(messageEvent('telegram', 'hello', 'other'))
    now += HOUR_MS - 1_000
    await app.send(messageEvent('telegram', 'still within the hour', 'stranger'))
    now += 2_000
    await app.send(messageEvent('telegram', 'hello again', 'stranger'))
    await app.send(messageEvent('telegram', 'hello again', 'other'))
    expect(app.replies()).toEqual(Array.from({ length: 4 }, () => app.policy.refusalText))
  })

  it('a hook failure blocks in silence', async () => {
    const throwing: PairingStore = {
      issue: () => '000000',
      approve: () => Promise.resolve({ ok: false, reason: 'unknown_or_expired' }),
      isPaired: () => {
        throw new Error('the store broke')
      },
    }
    const app = await instance({ pairing: throwing })
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      await app.send(inGroup(messageEvent('telegram', 'hello', 'stranger')))
      expect(stderr).not.toHaveBeenCalled()
    } finally {
      stderr.mockRestore()
    }
    expect(app.replies()).toEqual([])
    expect(app.handled).toHaveLength(0)
    expect(app.lines).toHaveLength(1)
    expect(app.lines[0]).toContain('telegram')
    expect(app.lines[0]).toContain('the store broke')
    expect(app.lines[0]).not.toContain('stranger')
  })

  it('an owner /approve with surrounding spaces pairs and a non-numeric code is refused', async () => {
    const app = await instance()
    await app.send(messageEvent('telegram', 'hello', 'stranger'))
    const code = /\d{6}/.exec(app.replies()[0] ?? '')?.[0] ?? ''
    await app.send(messageEvent('telegram', '/approve abcdef', OWNER_ID))
    await app.send(messageEvent('telegram', `  /approve   ${code}  `, OWNER_ID))
    expect(app.replies().slice(1)).toEqual(['That code is not valid or has expired.', 'Paired.'])
    expect(app.pairing?.isPaired('telegram', 'stranger')).toBe(true)
    expect(app.handled).toHaveLength(0)
  })

  it("an owner's bare /approve is answered and never reaches the handler", async () => {
    const app = await instance()
    await app.send(messageEvent('telegram', '/approve', OWNER_ID))
    expect(app.replies()).toEqual(['That code is not valid or has expired.'])
    expect(app.handled).toHaveLength(0)
  })

  it('an email owner reaches the handler whatever the case of the sender address', async () => {
    const app = await instance({ platform: 'email', env: { THEOCLAW_OWNERS: 'email:Paulo@Example.com' } })
    await app.send(messageEvent('email', 'hello', 'paulo@example.com'))
    await app.send(messageEvent('email', 'hello', 'PAULO@EXAMPLE.COM'))
    expect(app.handled).toHaveLength(2)
  })
})
