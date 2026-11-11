/** OC-118: THEOCLAW_ADVISOR=on reviews the turn on a fork and steers it with approved advice only. */
import { describe, expect, it } from 'vitest'

import type { GatewayContext, MessageEvent } from '@theokit/gateway'

import { approvedAdvice, readAdvisorSettings } from '../src/channels/advisor.js'
import { createReplyHandler } from '../src/channels/reply-handler.js'
import type { SessionLease } from '../src/sessions/session-agents.js'
import { FakeAgent, assistant, finished, messageEvent } from './fakes.js'

async function run(ask: (instruction: string) => Promise<string>, env: Record<string, string> = { THEOCLAW_ADVISOR: 'on' }) {
  const logs: string[] = []
  let release: () => void = () => undefined
  const before = new Promise<void>((resolve) => (release = resolve))
  const fake = new FakeAgent({ frames: [assistant('That was already done.'), finished()], before })
  const sends: { text: string; queueMode?: string }[] = []
  const agent = {
    send: async (text: string, options?: { queueMode?: string }) => {
      sends.push({ text, ...(options?.queueMode === undefined ? {} : { queueMode: options.queueMode }) })
      return fake.send(text)
    },
  } as never
  const handler = createReplyHandler({
    reset: async () => undefined,
    withAgent: async <R>(_e: MessageEvent, work: (lease: SessionLease) => R | Promise<R>): Promise<R> => work({ agent, agentId: 'a1', release: () => undefined }),
    ...(readAdvisorSettings(env, (line) => logs.push(line), ask) === undefined ? {} : { advisor: readAdvisorSettings(env, (line) => logs.push(line), ask)! }),
  })
  const event = messageEvent('telegram', 'redo the file list')
  const replies: string[] = []
  const ctx: GatewayContext = { event, reply: async (reply) => (replies.push(reply), { ok: true, messageId: 'm' }) }
  const done = handler(event, ctx)
  for (let i = 0; i < 50 && logs.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5))
  release()
  await done
  return { logs, sends, replies }
}

describe('advisor', () => {
  it('is off unless THEOCLAW_ADVISOR=on', () => {
    expect(readAdvisorSettings({}, () => undefined)).toBeUndefined()
  })

  it('cuts advice to 120 words and drops NONE', () => {
    expect(approvedAdvice('NONE')).toBeUndefined()
    expect(approvedAdvice('word '.repeat(300))?.split(' ')).toHaveLength(120)
  })

  it('steers the running turn with advice the second fork verified', async () => {
    const asked: string[] = []
    const out = await run(async (instruction) => (asked.push(instruction), 'The file list was already produced.'))
    expect(asked).toHaveLength(2)
    expect(out.sends[1]).toEqual({ text: '[advisor note] The file list was already produced.', queueMode: 'steer' })
    expect(out.logs[0]).toContain('advisor: steered session a1')
  })

  it('does not steer when the verifier rejects the draft', async () => {
    let calls = 0
    const out = await run(async () => (++calls === 1 ? 'Draft.' : 'NONE'))
    expect(out.sends).toHaveLength(1)
    expect(out.logs[0]).toContain('no correction')
  })
})
