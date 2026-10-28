import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { GatewayRunner } from '@theokit/gateway'
import type { GatewayHook, MessageEvent, PlatformName } from '@theokit/gateway'
import { afterEach, describe, expect, it } from 'vitest'

import type { TurnAgent } from '../../src/agent-port.js'
import { createOwnerPolicyHook } from '../../src/authorization/owner-policy-hook.js'
import { createPairingStore } from '../../src/authorization/pairing-store.js'
import { parseAuthorizationPolicy } from '../../src/authorization/policy.js'
import { createBroadcastGroups } from '../../src/channels/broadcast-groups.js'
import { createReplyHandler } from '../../src/channels/reply-handler.js'
import { createContainer } from '../../src/composition.js'
import { createChannelAgentFactory } from '../../src/control-plane/agent-factory.js'
import { FakeAdapter, messageEvent, waitFor } from '../fakes.js'

/**
 * AC-008 (B-371): OC-18, OC-19 and OC-21 against a real model. Each test runs the owner policy hook,
 * B-369's reply handler and a channel agent on THEOCLAW_MODEL over in-memory adapters, the shape the
 * composed app gives every runner. A turn counts only when the SDK's `wait()` resolved
 * `status: 'finished'` and no `on_error` fired, so the handler's fixed error reply can never pass for
 * a model answer. Runs only with THEOCLAW_LIVE=1; never in CI.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const TURN_TIMEOUT_MS = 120_000
const OWNER = 'owner-1'

const dirs: string[] = []
const runners: GatewayRunner[] = []

afterEach(async () => {
  await Promise.all(runners.splice(0).map((runner) => runner.stop()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** The model settings a live run needs; a missing one fails the run, naming it, and never skips. */
function requireModelSettings(): void {
  if (!process.env.THEOCLAW_MODEL) throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL')
  if (!process.env.THEOKIT_API_KEY && !process.env.OPENROUTER_API_KEY) {
    throw new Error('THEOCLAW_LIVE=1 needs THEOKIT_API_KEY or OPENROUTER_API_KEY')
  }
}

interface LiveOptions {
  readonly env: Readonly<Record<string, string>>
  readonly platforms: readonly PlatformName[]
}

/** A runner over in-memory adapters with the real hook, reply handler and model agent. */
async function liveApp({ env, platforms }: LiveOptions) {
  requireModelSettings()
  const policy = parseAuthorizationPolicy(env)
  const pairing = policy.stateDir === undefined ? undefined : createPairingStore({ dir: policy.stateDir })
  const real = createChannelAgentFactory(process.env)
  const prompts: string[] = []
  let completedTurns = 0
  let onErrorCalls = 0
  const handled: string[] = []
  // Counts the turns the SDK reports finished, and keeps every prompt the agent was sent.
  const agents = createContainer<TurnAgent>({
    factory: async () => {
      const agent = await real()
      return {
        send: async (text) => {
          prompts.push(text)
          const run = await agent.send(text)
          return {
            stream: () => run.stream(),
            wait: async () => {
              const result = await run.wait()
              if (result.status === 'finished') completedTurns += 1
              return result
            },
          }
        },
        // The request boundary disposes the agent; this wrapper forwards it.
        [Symbol.asyncDispose]: async () => {
          await (agent as unknown as { [Symbol.asyncDispose]?: () => Promise<void> })[Symbol.asyncDispose]?.()
        },
      } as TurnAgent
    },
  })
  const adapters = new Map(platforms.map((platform) => [platform, new FakeAdapter(platform)] as const))
  const onError: GatewayHook = { name: 'live-on-error-spy', pre_inbound: () => undefined, on_error: () => void (onErrorCalls += 1) }
  const reply = createReplyHandler({
    withAgent: (work) => agents.withAgent(work),
    broadcast: {
      groups: createBroadcastGroups(policy.broadcastGroups),
      adapterFor: (platform) => adapters.get(platform as PlatformName),
      write: (line) => void process.stderr.write(`${line}\n`),
    },
  })
  const runner = new GatewayRunner({
    adapters: [...adapters.values()],
    handler: async (event, ctx) => {
      handled.push(event.sender.id)
      await reply(event, ctx)
    },
    hooks: [createOwnerPolicyHook({ policy, ...(pairing === undefined ? {} : { pairing }) }), onError],
  })
  runners.push(runner)
  await runner.start()
  const sent = (platform: PlatformName): string[] => adapters.get(platform)?.sent.map((message) => message.text) ?? []
  const deliver = async (event: MessageEvent, replies: number): Promise<void> => {
    await adapters.get(event.platform as PlatformName)?.deliver(event)
    await waitFor(() => sent(event.platform as PlatformName).length >= replies, TURN_TIMEOUT_MS - 10_000, `reply ${replies} on ${event.platform}`)
  }
  return {
    prompts,
    handled,
    sent,
    deliver,
    completedTurns: () => completedTurns,
    onErrorCalls: () => onErrorCalls,
  }
}

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-live-authorization-'))
  dirs.push(dir)
  return dir
}

describe.skipIf(!LIVE)('the owner policy against a real model', () => {
  it('an owner message gets a real-model reply for OC-18', { timeout: TURN_TIMEOUT_MS }, async () => {
    const app = await liveApp({
      env: { THEOCLAW_OWNERS: `telegram:${OWNER}`, THEOCLAW_DM_POLICY: 'allowlist' },
      platforms: ['telegram'],
    })
    await app.deliver(messageEvent('telegram', 'Reply with the single word: pong', OWNER), 1)
    await app.deliver(messageEvent('telegram', 'Reply with the single word: pong', 'stranger'), 2)

    const [ownerReply, refusal] = app.sent('telegram')
    expect(app.completedTurns()).toBe(1)
    expect(app.prompts).toHaveLength(1)
    expect(app.onErrorCalls()).toBe(0)
    expect(ownerReply?.length ?? 0).toBeGreaterThan(0)
    expect(refusal).toBe('This assistant answers its owner only.')
    expect(app.handled.filter((sender) => sender === 'stranger')).toHaveLength(0)
  })

  it('an unlisted DM gets a pairing code the owner approves for OC-19', { timeout: TURN_TIMEOUT_MS }, async () => {
    const app = await liveApp({
      env: { THEOCLAW_OWNERS: `telegram:${OWNER}`, THEOCLAW_STATE_DIR: stateDir() },
      platforms: ['telegram'],
    })
    await app.deliver(messageEvent('telegram', 'hello', 'stranger'), 1)
    const codeReply = app.sent('telegram')[0] ?? ''
    expect(codeReply).toMatch(/\d{6}/)
    const code = /\d{6}/.exec(codeReply)?.[0] ?? ''
    await app.deliver(messageEvent('telegram', `/approve ${code}`, OWNER), 2)
    expect(app.sent('telegram')[1]).toBe('Paired.')
    await app.deliver(messageEvent('telegram', 'Reply with the single word: pong', 'stranger'), 3)

    expect(app.sent('telegram')[2]?.length ?? 0).toBeGreaterThan(0)
    expect(app.completedTurns()).toBe(1)
    expect(app.onErrorCalls()).toBe(0)
  })

  it('a broadcast answer reaches both member channels for OC-21', { timeout: TURN_TIMEOUT_MS }, async () => {
    const app = await liveApp({
      env: {
        THEOCLAW_OWNERS: `telegram:${OWNER},discord:${OWNER}`,
        THEOCLAW_DM_POLICY: 'allowlist',
        THEOCLAW_BROADCAST_GROUPS: 'home=telegram:tg-chat,discord:dc-channel',
      },
      platforms: ['telegram', 'discord'],
    })
    const inChannel = (platform: PlatformName, channelId: string, text: string): MessageEvent =>
      ({ ...messageEvent(platform, text, OWNER), channel: { id: channelId, type: 'dm' } }) as MessageEvent
    const firstQuestion = 'Remember the word blue. Reply with one plain sentence, no formatting.'
    await app.deliver(inChannel('telegram', 'tg-chat', firstQuestion), 1)
    await waitFor(() => app.sent('discord').length === 1, 10_000, 'the broadcast to reach discord')
    const [telegramSend] = app.sent('telegram')
    const [discordSend] = app.sent('discord')
    await app.deliver(inChannel('discord', 'dc-channel', 'Which word did I ask you to remember? Reply with that single plain word.'), 2)

    const secondPrompt = app.prompts[1] ?? ''
    expect(app.completedTurns()).toBe(2)
    expect(app.onErrorCalls()).toBe(0)
    expect(telegramSend?.length ?? 0).toBeGreaterThan(0)
    expect(telegramSend).toBe(discordSend)
    expect(secondPrompt).toContain(firstQuestion)
    // The thread keeps the raw answer, which Discord receives unchanged; Telegram strips markdown.
    expect(secondPrompt).toContain(discordSend)
  })
})
