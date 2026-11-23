import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { GatewayRunner } from '@theokit/gateway'
import type { GatewayHook, MessageEvent } from '@theokit/gateway'
import { afterEach, describe, expect, it } from 'vitest'

import { createOwnerPolicyHook } from '../src/authorization/owner-policy-hook.js'
import { createPairingStore } from '../src/authorization/pairing-store.js'
import { parseAuthorizationPolicy } from '../src/authorization/policy.js'
import { FakeAdapter, messageEvent, waitFor } from './fakes.js'

const dirs: string[] = []
const runners: GatewayRunner[] = []

afterEach(async () => {
  await Promise.all(runners.splice(0).map((runner) => runner.stop()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Dispatches still running: the runner's `@internal` `_inflightSize` test seam, absent from its types. */
function inflight(runner: GatewayRunner): number {
  return (runner as unknown as { readonly _inflightSize: number })._inflightSize
}

type ChannelType = 'dm' | 'group'

/** What one instance's bot sends, as the other instance receives it. */
function fromBot(botId: string, text: string, channel: ChannelType): MessageEvent {
  const event = messageEvent('telegram', text, botId)
  return channel === 'dm' ? event : ({ ...event, channel: { id: 'shared-group', type: 'group' } } as MessageEvent)
}

/**
 * One TheoClaw instance: its owner policy hook behind a counting hook (so a silent run is known to
 * have reached the hook), and a handler that always answers, as the agent would.
 */
function instance(owner: string, dmPolicy: string) {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-loop-'))
  dirs.push(dir)
  const policy = parseAuthorizationPolicy({
    THEOCLAW_OWNERS: `telegram:${owner}`,
    THEOCLAW_DM_POLICY: dmPolicy,
    THEOCLAW_STATE_DIR: dir,
  })
  let seen = 0
  const counting: GatewayHook = {
    name: 'count-inbound',
    pre_inbound: () => {
      seen += 1
    },
  }
  let peer: { deliver(event: MessageEvent): unknown; botId: string; channel: ChannelType } | undefined
  const adapter = new FakeAdapter('telegram', {
    send: async (message) => {
      // The other instance receives this reply as a message from this bot, on a later turn of the
      // event loop so a runaway exchange cannot starve the timers that end the test.
      const target = peer
      if (target !== undefined) setImmediate(() => void target.deliver(fromBot(target.botId, message.text, target.channel)))
      return { ok: true, messageId: `sent-${owner}` }
    },
  })
  const runner = new GatewayRunner({
    adapters: [adapter],
    handler: async (_event, ctx) => void (await ctx.reply('an answer')),
    hooks: [counting, createOwnerPolicyHook({ policy, pairing: createPairingStore({ dir }) })],
  })
  runners.push(runner)
  return {
    adapter,
    runner,
    seen: () => seen,
    linkTo(other: { adapter: FakeAdapter }, botId: string, channel: ChannelType) {
      peer = { deliver: (event) => other.adapter.deliver(event), botId, channel }
    },
  }
}

/** Run two instances against each other until no message moves, and return how many were sent. */
async function exchange(dmPolicy: string, channel: ChannelType): Promise<number> {
  const a = instance('owner-a', dmPolicy)
  const b = instance('owner-b', dmPolicy)
  a.linkTo(b, 'bot-a', channel)
  b.linkTo(a, 'bot-b', channel)
  await Promise.all([a.runner.start(), b.runner.start()])
  await Promise.all([
    a.adapter.deliver(fromBot('bot-b', 'hello', channel)),
    b.adapter.deliver(fromBot('bot-a', 'hello', channel)),
  ])
  await waitFor(() => a.seen() >= 1 && b.seen() >= 1, 2000, 'both hooks to see their first message')
  const total = (): number => a.adapter.sent.length + b.adapter.sent.length
  // Quiet: two reads 20 ms apart agree and nothing is in flight (rules/testing.md § 3).
  const deadline = Date.now() + 2000
  for (;;) {
    const before = total()
    await new Promise((resolve) => setTimeout(resolve, 20))
    const idle = inflight(a.runner) === 0 && inflight(b.runner) === 0
    if (idle && total() === before) return before
    if (Date.now() > deadline) throw new Error(`the two instances never went quiet (${total()} messages)`)
  }
}

describe('two instances with different owners', () => {
  it('two instances with different owners stop after one reply each in a DM', async () => {
    expect(await exchange('pairing', 'dm')).toBe(2)
  })

  it('the DM exchange ends per policy', async () => {
    expect(await exchange('allowlist', 'dm')).toBe(2)
    expect(await exchange('disabled', 'dm')).toBe(0)
  })

  it('two instances in one group send 0 replies to each other', async () => {
    expect(await exchange('pairing', 'group')).toBe(0)
  })

  it('two instances in one group send 0 replies to each other under the open policy', async () => {
    expect(await exchange('open', 'group')).toBe(0)
  })
})
