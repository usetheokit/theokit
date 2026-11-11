/** OC-52: `/steer <text>` injects text into the turn already running, with queueMode 'steer'. */
import { describe, expect, it } from 'vitest'

import type { GatewayContext, MessageEvent } from '@theokit/gateway'

import { createReplyHandler, STEER_IDLE_REPLY, STEER_USAGE_REPLY, STEERED_REPLY } from '../src/channels/reply-handler.js'
import type { SessionLease } from '../src/sessions/session-agents.js'
import { FakeAgent, assistant, finished, messageEvent } from './fakes.js'

function setup() {
  let release: () => void = () => undefined
  const before = new Promise<void>((resolve) => (release = resolve))
  const fake = new FakeAgent({ frames: [assistant('1. a 2. b 3. c'), finished()], before })
  const sends: { text: string; queueMode?: string }[] = []
  const agent = {
    send: async (text: string, options?: { queueMode?: string }) => {
      sends.push({ text, ...(options?.queueMode === undefined ? {} : { queueMode: options.queueMode }) })
      return fake.send(text)
    },
  } as never
  const handler = createReplyHandler({
    reset: async () => undefined,
    withAgent: async <R>(_e: MessageEvent, work: (lease: SessionLease) => R | Promise<R>): Promise<R> => work({ agent, release: () => undefined }),
  })
  const replies: string[] = []
  const call = (text: string) => {
    const event = messageEvent('telegram', text)
    const ctx: GatewayContext = { event, reply: async (reply) => (replies.push(reply), { ok: true, messageId: 'm' }) }
    return handler(event, ctx)
  }
  return { call, sends, replies, release: () => release() }
}

describe('/steer', () => {
  it('steers the running turn', async () => {
    const t = setup()
    const turn = t.call('list fruits')
    await new Promise((r) => setTimeout(r, 10))
    await t.call('/steer only the first three')
    expect(t.sends[1]).toEqual({ text: 'only the first three', queueMode: 'steer' })
    expect(t.replies).toContain(STEERED_REPLY)
    t.release()
    await turn
  })

  it('says so when nothing runs, and without text', async () => {
    const t = setup()
    await t.call('/steer stop')
    await t.call('/steer')
    expect(t.sends).toEqual([])
    expect(t.replies).toEqual([STEER_IDLE_REPLY, STEER_USAGE_REPLY])
  })
})
