/**
 * B-397 FR-008 (AC-004): `/goal <text>` runs the session agent's goal loop under a token budget and
 * replies once with the final status and text; a bare `/goal` replies with one usage line.
 */
import { describe, expect, it } from 'vitest'

import type { GatewayContext, MessageEvent } from '@theokit/gateway'

import type { TurnAgent } from '../src/agent-port.js'
import { GOAL_USAGE_REPLY, goalOf, readGoalSettings, runGoal } from '../src/channels/goal-command.js'
import { createReplyHandler } from '../src/channels/reply-handler.js'
import { composeTheoClaw } from '../src/composition.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'
import type { SessionLease } from '../src/sessions/session-agents.js'
import { fakeBuilders, noAgent, OPEN_DMS } from './composition-fixtures.js'
import { FakeAgent, assistant, finished, messageEvent, waitFor } from './fakes.js'

const ENV = { THEOCLAW_MODEL: 'openrouter/chat-model', OPENROUTER_API_KEY: 'router-key' }

interface GoalCall {
  readonly goal: string
  readonly options: Record<string, unknown>
}

/** A fake agent whose goal loop yields one event and returns `result`, recording each call. */
function goalAgent(result: { status: string; finalResponse?: string } | Error): TurnAgent & { readonly calls: GoalCall[] } {
  const calls: GoalCall[] = []
  const agent = new FakeAgent({ frames: [assistant('an ordinary turn'), finished()] }) as unknown as TurnAgent
  return Object.assign(agent, {
    calls,
    runUntil: async function* (goal: string, options: Record<string, unknown>) {
      calls.push({ goal, options })
      yield { type: 'turn_started' }
      if (result instanceof Error) throw result
      return result
    },
  })
}

function harness(agent: TurnAgent, env: Record<string, string> = ENV, secrets?: readonly string[]) {
  const replies: string[] = []
  let leases = 0
  const handler = createReplyHandler({
    reset: async () => undefined,
    withAgent: async <R>(_event: MessageEvent, work: (lease: SessionLease) => R | Promise<R>): Promise<R> => {
      leases += 1
      return work({ agent, agentId: 'a-1', release: () => undefined })
    },
    goal: readGoalSettings(env),
    ...(secrets === undefined ? {} : { secrets }),
  })
  const send = async (text: string): Promise<void> => {
    const event = messageEvent('telegram', text)
    const ctx: GatewayContext = {
      event,
      reply: async (reply) => {
        replies.push(reply)
        return { ok: true, messageId: 'm-1' }
      },
    }
    await handler(event, ctx)
  }
  return { replies, send, leases: () => leases }
}

describe('/goal in a chat', () => {
  it('replies with budget_limited when the goal loop stops on its budget', async () => {
    const agent = goalAgent({ status: 'budget_limited', finalResponse: 'partial' })
    const h = harness(agent)
    await h.send('/goal tidy the notes')
    expect(h.replies).toEqual(['budget_limited: partial'])
    expect(agent.calls.map((call) => call.goal)).toEqual(['tidy the notes'])
  })

  it('masks a configured value in the goal reply (B-398 FR-006)', async () => {
    const h = harness(goalAgent({ status: 'completed', finalResponse: 'the token is router-key' }), ENV, ['router-key'])
    await h.send('/goal leak it')
    expect(h.replies).toHaveLength(1)
    expect(h.replies[0]).not.toContain('router-key')
    expect(h.replies[0]).toContain('completed: the token is')
  })

  it('answers a bare /goal with one usage line and runs nothing', async () => {
    const agent = goalAgent({ status: 'completed', finalResponse: 'done' })
    const h = harness(agent)
    await h.send('/goal')
    expect(h.replies).toEqual([GOAL_USAGE_REPLY])
    expect(h.leases()).toBe(0)
    expect(agent.calls).toHaveLength(0)
  })

  it('answers `/goal   ` with the usage line too (EC-5)', async () => {
    const h = harness(goalAgent({ status: 'completed' }))
    await h.send('/goal   ')
    expect(h.replies).toEqual([GOAL_USAGE_REPLY])
    expect(h.leases()).toBe(0)
  })

  it('runs `/goals x` as an ordinary turn, not a goal (EC-5)', async () => {
    const agent = goalAgent({ status: 'completed' })
    const h = harness(agent)
    await h.send('/goals x')
    expect(agent.calls).toHaveLength(0)
    expect(h.replies).toEqual(['an ordinary turn'])
  })

  it('an agent without runUntil replies once with failed', async () => {
    const h = harness(new FakeAgent({ frames: [] }) as unknown as TurnAgent)
    await h.send('/goal do it')
    expect(h.replies).toHaveLength(1)
    expect(h.replies[0]).toMatch(/^failed: /)
  })

  it('a goal loop that throws replies once with failed, then rethrows for on_error', async () => {
    const h = harness(goalAgent(new Error('judge exploded')))
    await expect(h.send('/goal do it')).rejects.toThrow('judge exploded')
    expect(h.replies).toHaveLength(1)
    expect(h.replies[0]).toMatch(/^failed: /)
  })
})

describe('readGoalSettings and runGoal', () => {
  it('passes tokenBudget from THEOCLAW_GOAL_TOKEN_BUDGET, and agentModel = THEOCLAW_MODEL', async () => {
    const agent = goalAgent({ status: 'completed', finalResponse: 'ok' })
    await runGoal(agent, 'x', readGoalSettings({ ...ENV, THEOCLAW_GOAL_TOKEN_BUDGET: '500' }))
    expect(agent.calls[0]?.options).toMatchObject({ tokenBudget: 500, agentModel: 'openrouter/chat-model', judgeApiKey: 'router-key' })
  })

  it('passes a tokenBudget of 20000 when THEOCLAW_GOAL_TOKEN_BUDGET is unset', async () => {
    const agent = goalAgent({ status: 'completed', finalResponse: 'ok' })
    await runGoal(agent, 'x', readGoalSettings(ENV))
    expect(agent.calls[0]?.options).toMatchObject({ tokenBudget: 20_000 })
  })

  it('refuses a non-positive THEOCLAW_GOAL_TOKEN_BUDGET, naming the variable', () => {
    for (const value of ['0', '-5', '1.5', 'many']) {
      let thrown: unknown
      try {
        readGoalSettings({ ...ENV, THEOCLAW_GOAL_TOKEN_BUDGET: value })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(TheoClawConfigError)
      expect((thrown as TheoClawConfigError).variable).toBe('THEOCLAW_GOAL_TOKEN_BUDGET')
    }
  })

  it('replies with the no-answer line when the loop gives no final text', async () => {
    const outcome = await runGoal(goalAgent({ status: 'blocked' }), 'x', readGoalSettings(ENV))
    expect(outcome.reply).toMatch(/^blocked: /)
    expect(outcome.reply.length).toBeGreaterThan('blocked: '.length)
  })
})

describe('goalOf', () => {
  it('matches /goal on the whole trimmed text only', () => {
    expect(goalOf('/goal fix it')).toBe('fix it')
    expect(goalOf(' /goal ')).toBe('')
    expect(goalOf('/goals x')).toBeUndefined()
    expect(goalOf('please /goal x')).toBeUndefined()
  })
})

describe('/goal through the composed app', () => {
  it("runs the session agent's goal loop with the start's budget and replies once on the channel", async () => {
    const agent = goalAgent({ status: 'completed', finalResponse: 'notes tidied' })
    const { adapters, builders } = fakeBuilders()
    const app = composeTheoClaw({
      env: { ...OPEN_DMS, THEOCLAW_GOAL_TOKEN_BUDGET: '1234' },
      agentFactory: noAgent,
      getOrCreate: async () => Object.assign(agent, { dispose: async () => undefined }),
      builders,
      write: () => undefined,
    })
    await app.loop.ready
    const telegram = adapters.get('telegram')!
    await telegram.deliver(messageEvent('telegram', '/goal tidy the notes'))
    await waitFor(() => telegram.sent.length === 1, 5000, 'the goal reply')
    expect(telegram.sent[0]?.text).toBe('completed: notes tidied')
    expect(agent.calls[0]?.options).toMatchObject({ tokenBudget: 1234 })
    await app.loop.stopAll()
    await app.sessions.disposeAll()
  })
})
