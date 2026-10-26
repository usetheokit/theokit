/**
 * The owner policy through the composed app: composeTheoClaw wires parseAuthorizationPolicy,
 * createPairingStore and createOwnerPolicyHook into every runner, over in-memory adapters and a
 * stub agent. The policy and the store are then read back the way an operator would see them.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MessageEvent, PlatformName } from '@theokit/gateway'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createOwnerPolicyHook } from '../../src/authorization/owner-policy-hook.js'
import { createPairingStore } from '../../src/authorization/pairing-store.js'
import { parseAuthorizationPolicy, senderKey } from '../../src/authorization/policy.js'
import type { PlatformBuild } from '../../src/channels/channel-loop.js'
import { composeTheoClaw } from '../../src/composition.js'
import { FakeAdapter, FakeAgent, assistant, finished, messageEvent, waitFor } from '../fakes.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theoclaw-authorization-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function composedApp(env: Readonly<Record<string, string>>, platforms: readonly PlatformName[] = ['telegram', 'discord']) {
  const adapters = new Map<PlatformName, FakeAdapter>()
  const builders = (): PlatformBuild[] =>
    platforms.map((platform) => ({
      platform,
      build: () => {
        const adapter = new FakeAdapter(platform)
        adapters.set(platform, adapter)
        return adapter
      },
    }))
  const asked: string[] = []
  const composed = composeTheoClaw({
    env,
    agentFactory: () =>
      new FakeAgent({
        frames: (text) => {
          asked.push(text)
          return [assistant(`answer to ${text}`), finished()]
        },
      }),
    builders,
    write: () => undefined,
  })
  const sent = (platform: PlatformName): string[] => adapters.get(platform)?.sent.map((message) => message.text) ?? []
  const deliver = async (event: MessageEvent, expectedReplies: number): Promise<void> => {
    await adapters.get(event.platform as PlatformName)?.deliver(event)
    await waitFor(() => sent(event.platform as PlatformName).length >= expectedReplies, 2000, `${expectedReplies} replies on ${event.platform}`)
  }
  return { ...composed, asked, sent, deliver }
}

describe('composeTheoClaw with parseAuthorizationPolicy, createPairingStore and createOwnerPolicyHook', () => {
  it('the composed app answers its owner and pairs a stranger', async () => {
    const env = { THEOCLAW_OWNERS: 'telegram:owner', THEOCLAW_STATE_DIR: dir }
    const app = composedApp(env)
    await app.loop.ready

    await app.deliver(messageEvent('telegram', 'hello', 'owner'), 1)
    expect(app.sent('telegram')).toEqual(['answer to hello'])

    await app.deliver(messageEvent('discord', 'hi there', 'stranger'), 1)
    const code = /\d{6}/.exec(app.sent('discord')[0] ?? '')?.[0] ?? ''
    expect(code).toMatch(/^\d{6}$/)
    expect(app.asked).toEqual(['hello'])

    await app.deliver(messageEvent('telegram', `/approve ${code}`, 'owner'), 2)
    expect(app.sent('telegram')[1]).toBe('Paired.')

    await app.deliver(messageEvent('discord', 'hi again', 'stranger'), 2)
    expect(app.sent('discord')[1]).toBe('answer to hi again')
    await app.loop.stopAll()

    // What the operator finds afterwards: the pairing on disk, under the policy that was parsed.
    const policy = parseAuthorizationPolicy(env)
    const reloaded = createPairingStore({ dir: policy.stateDir ?? dir })
    expect(reloaded.isPaired('discord', 'stranger')).toBe(true)
    expect(createOwnerPolicyHook({ policy, pairing: reloaded }).name).toBe('theoclaw-owner-policy')
  })

  it('an email owner is recognised through senderKey whatever the case of the address', async () => {
    const env = { THEOCLAW_OWNERS: 'email:Paulo@Example.com', THEOCLAW_DM_POLICY: 'allowlist' }
    const app = composedApp(env, ['email'])
    await app.loop.ready
    await app.deliver(messageEvent('email', 'hello', 'PAULO@example.COM'), 1)
    expect(app.sent('email')).toEqual(['answer to hello'])
    await app.loop.stopAll()
    expect(parseAuthorizationPolicy(env).owners.has(senderKey('email', 'paulo@EXAMPLE.com'))).toBe(true)
  })

  it('createGroupActivationHook in the composed app answers a mentioned telegram group message and ignores an unmentioned one', async () => {
    const app = composedApp({ THEOCLAW_OWNERS: 'telegram:owner', THEOCLAW_DM_POLICY: 'allowlist' }, ['telegram'])
    await app.loop.ready
    const inGroup = (text: string): MessageEvent =>
      ({
        ...messageEvent('telegram', text, 'owner'),
        channel: { id: '-100', type: 'group' },
        telegram: { chatId: -100, messageId: 1, raw: { chat: { id: -100, type: 'group' }, message: { text }, me: { username: 'theo_bot', id: 99 } } },
      }) as unknown as MessageEvent
    await app.deliver(inGroup('nobody asked the bot'), 0)
    await app.deliver(inGroup('@theo_bot what time is it'), 1)
    expect(app.asked).toEqual(['@theo_bot what time is it'])
    await app.loop.stopAll()
  })

  it('createBroadcastGroups in the composed app carries one thread across a telegram and a discord channel', async () => {
    const app = composedApp({
      THEOCLAW_OWNERS: 'telegram:owner,discord:owner',
      THEOCLAW_DM_POLICY: 'allowlist',
      THEOCLAW_BROADCAST_GROUPS: 'home=telegram:-100,discord:dc-1',
    })
    await app.loop.ready
    const inChannel = (platform: PlatformName, channelId: string, text: string): MessageEvent =>
      ({ ...messageEvent(platform, text, 'owner'), channel: { id: channelId, type: 'dm' } }) as MessageEvent
    await app.deliver(inChannel('telegram', '-100', 'first question'), 1)
    await waitFor(() => app.sent('discord').length === 1, 2000, 'the broadcast to reach discord')
    await app.deliver(inChannel('discord', 'dc-1', 'second question'), 2)
    expect(app.asked[1]).toContain('first question')
    expect(app.sent('telegram')).toHaveLength(2)
    expect(app.sent('telegram')[1]).toBe(app.sent('discord')[1])
    await app.loop.stopAll()
  })
})
