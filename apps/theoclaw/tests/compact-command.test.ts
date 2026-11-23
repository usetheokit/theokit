/** OC-53: `/compact` compacts the session's transcript and answers one line; THEOCLAW_COMPACT_AT does it after a big turn. */
import { describe, expect, it } from 'vitest'

import type { GatewayContext, MessageEvent } from '@theokit/gateway'

import { compactOf, readCompactSettings } from '../src/channels/compact-command.js'
import { createReplyHandler } from '../src/channels/reply-handler.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'
import type { SessionLease } from '../src/sessions/session-agents.js'
import { FakeAgent, assistant, finished, messageEvent } from './fakes.js'

function harness(env: Record<string, string>, run: (id: string, trigger: string) => Promise<{ preTokens: number; postTokens: number }>, inputTokens = 0) {
  const replies: string[] = []
  const logs: string[] = []
  const agent = new FakeAgent({ frames: [assistant('hi'), finished()], result: { status: 'finished', usage: { inputTokens } } }) as never
  const handler = createReplyHandler({
    reset: async () => undefined,
    withAgent: async <R>(_e: MessageEvent, work: (lease: SessionLease) => R | Promise<R>): Promise<R> => work({ agent, agentId: 'theoclaw-x-g0', release: () => undefined }),
    compact: readCompactSettings(env, (line) => logs.push(line), run),
  })
  const send = async (text: string): Promise<void> => {
    const event = messageEvent('telegram', text)
    const ctx: GatewayContext = { event, reply: async (reply) => (replies.push(reply), { ok: true, messageId: 'm' }) }
    await handler(event, ctx)
  }
  return { replies, logs, send }
}

describe('/compact', () => {
  it('matches the whole command only', () => {
    expect(compactOf('/compact')).toBe('')
    expect(compactOf('/compact keep the dates')).toBe('keep the dates')
    expect(compactOf('/compacted')).toBeUndefined()
  })

  it('compacts the session agent and replies with a summary line', async () => {
    const calls: string[] = []
    const h = harness({}, async (id, trigger) => (calls.push(`${id}:${trigger}`), { preTokens: 26000, postTokens: 24000 }))
    await h.send('/compact')
    expect(calls).toEqual(['theoclaw-x-g0:manual'])
    expect(h.replies).toEqual(['⚙️ Compacted (26000 → 24000 tokens)'])
  })

  it('says so when the compaction fails', async () => {
    const h = harness({}, async () => {
      throw new Error('no transcript')
    })
    await h.send('/compact')
    expect(h.replies).toHaveLength(1)
    expect(h.replies[0]).toContain('could not compact')
    expect(h.logs[0]).toContain('no transcript')
  })

  it('refuses a bad THEOCLAW_COMPACT_AT', () => {
    expect(() => readCompactSettings({ THEOCLAW_COMPACT_AT: 'lots' }, () => undefined)).toThrow(TheoClawConfigError)
    expect(() => readCompactSettings({ THEOCLAW_COMPACT_AT: '0' }, () => undefined)).toThrow(TheoClawConfigError)
  })

  it('compacts after a turn only when its input reached the threshold', async () => {
    const calls: string[] = []
    const run = async (_id: string, trigger: string) => (calls.push(trigger), { preTokens: 500, postTokens: 20 })
    await harness({ THEOCLAW_COMPACT_AT: '100' }, run, 99).send('hello')
    expect(calls).toEqual([])
    const big = harness({ THEOCLAW_COMPACT_AT: '100' }, run, 100)
    await big.send('hello')
    expect(calls).toEqual(['auto'])
    expect(big.logs[0]).toContain('500 -> 20')
  })
})
