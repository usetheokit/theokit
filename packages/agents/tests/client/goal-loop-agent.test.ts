import { runGoalLoop } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import { AgentClient } from '../../src/client/agent-client.js'
import { asGoalLoopAgent, GoalTurnFailedError } from '../../src/client/goal-loop-agent.js'

const turn = (text: string): ReadableStream =>
  new ReadableStream({
    start(c) {
      c.enqueue({ type: 'start' })
      c.enqueue({ type: 'text-start', id: 't' })
      c.enqueue({ type: 'text-delta', id: 't', delta: text })
      c.enqueue({ type: 'text-end', id: 't' })
      c.enqueue({ type: 'finish', messageMetadata: { usage: { totalTokens: 10 }, durationMs: 1 } })
      c.close()
    },
  })

describe('asGoalLoopAgent', () => {
  it('asGoalLoopAgent drives runGoalLoop through two turns', async () => {
    let n = 0
    const client = new AgentClient<string>({
      sendMessages: () => Promise.resolve(turn(`turn ${String(++n)}`)),
    } as never)
    let judged = 0
    const gen = runGoalLoop(asGoalLoopAgent(client), 'ship it', {}, {
      judge: () => {
        judged += 1
        return Promise.resolve(
          judged < 2
            ? { verdict: 'continue', reason: 'more', parseFailed: false }
            : { verdict: 'done', reason: 'ok', parseFailed: false },
        )
      },
    } as never)
    let step = await gen.next()
    while (!step.done) step = await gen.next()
    expect(n).toBe(2)
    expect(judged).toBe(2)
  })

  it('asGoalLoopAgent wait rejects with GoalTurnFailedError on a failed turn', async () => {
    const client = new AgentClient<string>({
      sendMessages: () => Promise.reject(new Error('down')),
    } as never)
    const handle = await asGoalLoopAgent(client).send('go')
    const err = await handle.wait().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GoalTurnFailedError)
    expect((err as GoalTurnFailedError).status).toBe('error')
  })
})
