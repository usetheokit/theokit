import { EventEmitter } from 'node:events'
import { chmodSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { MessageEvent } from '@theokit/gateway'
import { Agent } from '@theokit/sdk'
import type { AgentOptions } from '@theokit/sdk'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { composeTheoClaw, startTheoClaw } from '../src/composition.js'
import type { RunningTheoClaw } from '../src/composition.js'

import { Generations } from '../src/sessions/generations.js'
import { SessionAgents } from '../src/sessions/session-agents.js'
import type { SessionAgent } from '../src/sessions/session-agents.js'
import { createSessionRouter } from '../src/sessions/session-key.js'
import type { SessionSettings } from '../src/sessions/session-settings.js'
import { capturingStream, fakeBuilders, scratchWorkspace, OPEN_DMS } from './composition-fixtures.js'
import { FakeAgent, assistant, deferred, finished, messageEvent, waitFor } from './fakes.js'
import { startModelStub } from './session-model-stub.js'

const SETTINGS: SessionSettings = {
  dmScope: 'per-channel-peer',
  peerLinks: new Map(),
  workspace: '/srv/theoclaw',
  idleMinutes: 30,
  maxOpenSessions: 200,
}

function dm(sender: string, text = 'hi'): MessageEvent {
  return {
    id: `m-${sender}`,
    platform: 'telegram',
    sender: { id: sender },
    channel: { id: `c-${sender}`, type: 'dm' },
    text,
    receivedAt: 0,
    telegram: { raw: null },
  } as unknown as MessageEvent
}

function idleAgent(): SessionAgent {
  return { send: () => Promise.reject(new Error('no turn here')), dispose: vi.fn(async () => undefined) }
}

function sessions(getOrCreate: (id: string, options: AgentOptions) => Promise<SessionAgent>): SessionAgents {
  return new SessionAgents({
    router: createSessionRouter(SETTINGS),
    getOrCreate,
    optionsFor: () => ({ model: 'stub' }),
    generations: new Generations(),
    settings: SETTINGS,
    write: () => undefined,
  })
}

describe('SessionAgents.lease', () => {
  it('two first messages of one session make one getOrCreate call', async () => {
    for (let repetition = 0; repetition < 20; repetition += 1) {
      const resolving = deferred<SessionAgent>()
      const getOrCreate = vi.fn(() => resolving.promise)
      const agents = sessions(getOrCreate)

      const first = agents.lease(dm('u1'))
      const second = agents.lease(dm('u1'))
      resolving.resolve(idleAgent())
      const [a, b] = await Promise.all([first, second])

      expect(getOrCreate).toHaveBeenCalledTimes(1)
      expect(a.agent).toBe(b.agent)
      a.release()
      b.release()
    }
  })

  it('two senders in one dm scope get two agent ids', async () => {
    const getOrCreate = vi.fn(async (_id: string, _options: AgentOptions) => idleAgent())
    const agents = sessions(getOrCreate)

    await agents.lease(dm('alice'))
    await agents.lease(dm('bob'))

    expect(getOrCreate.mock.calls.map(([id]) => id)).toEqual(['theoclaw-telegram-dm-alice-g0', 'theoclaw-telegram-dm-bob-g0'])
  })

  it('a later message of a session reuses its open agent', async () => {
    const getOrCreate = vi.fn(async () => idleAgent())
    const agents = sessions(getOrCreate)

    const first = await agents.lease(dm('u1'))
    first.release()
    const second = await agents.lease(dm('u1'))

    expect(getOrCreate).toHaveBeenCalledTimes(1)
    expect(second.agent).toBe(first.agent)
  })

  it('a failed resolve rejects every waiter and the next message retries', async () => {
    const failure = new Error('provider down')
    const getOrCreate = vi.fn<(id: string, options: AgentOptions) => Promise<SessionAgent>>().mockRejectedValueOnce(failure)
    getOrCreate.mockImplementation(async () => idleAgent())
    const agents = sessions(getOrCreate)

    const results = await Promise.allSettled([agents.lease(dm('u1')), agents.lease(dm('u1'))])
    expect(results.map((result) => (result.status === 'rejected' ? result.reason : 'ok'))).toEqual([failure, failure])

    await expect(agents.lease(dm('u1'))).resolves.toHaveProperty('agent')
    expect(getOrCreate).toHaveBeenCalledTimes(2)
  })

  it('a lease carries neither dispose nor Symbol.asyncDispose', async () => {
    const agents = sessions(async () => idleAgent())
    const lease = await agents.lease(dm('u1'))
    expect('dispose' in lease).toBe(false)
    expect(Symbol.asyncDispose in lease).toBe(false)
  })
})

/** The `/control` factory: a chat message must never reach it. */
function throwingAgentFactory() {
  const calls = { count: 0 }
  const factory = (): never => {
    calls.count += 1
    throw new Error('the /control factory must not build a chat agent')
  }
  return { calls, factory }
}

const SESSIONS = 20
/** The SDK's openai profile refuses a key that does not look like one, so the stub runs get this. */
const STUB_KEY = 'sk-stub-key-0123456789'

describe('the chat path through startTheoClaw', () => {
  const workspace = scratchWorkspace()
  const fresh = scratchWorkspace()
  const existing = scratchWorkspace()
  const running: RunningTheoClaw[] = []
  afterAll(async () => {
    for (const app of running.splice(0)) {
      await app.loop.stopAll()
      await app.sessions.disposeAll()
      await app.close()
    }
  })

  // NFR-002, 20 of 20: each repetition is its own session (its own sender), all run at once.
  it('two messages during one running turn get two replies in order', { timeout: 60_000 }, async () => {
    const stub = await startModelStub({
      delayMs: 2000,
      reply: (request) => `answer to ${stub.userTexts(request).at(-1) ?? ''}`,
    })
    const received: AgentOptions[] = []
    const control = throwingAgentFactory()
    const { adapters, builders } = fakeBuilders()
    const app = await startTheoClaw({
      env: { ...OPEN_DMS, OPENROUTER_API_KEY: STUB_KEY, THEOCLAW_WORKSPACE: workspace },
      agentFactory: control.factory,
      getOrCreate: (id, options) => {
        received.push(options)
        return Agent.getOrCreate(id, { ...options, model: { id: 'openai/stub', url: stub.url } })
      },
      builders,
      signals: new EventEmitter(),
      exit: vi.fn(),
      streams: [capturingStream()],
    })
    running.push(app)
    await app.loop.ready
    const telegram = adapters.get('telegram')!

    for (let n = 0; n < SESSIONS; n += 1) void telegram.deliver(messageEvent('telegram', `s${n} first`, `user-${n}`))
    await waitFor(() => stub.requests.length === SESSIONS, 20_000, 'every first message to reach the model')
    for (let n = 0; n < SESSIONS; n += 1) void telegram.deliver(messageEvent('telegram', `s${n} second`, `user-${n}`))
    await waitFor(() => telegram.sent.length === 2 * SESSIONS, 40_000, 'two replies per session')
    await stub.close()

    const lastUserText = (index: number): string | undefined => stub.userTexts(stub.requests[index]!).at(-1)
    for (let n = 0; n < SESSIONS; n += 1) {
      const replies = telegram.sent.filter((message) => message.channel.id === `telegram-channel-user-${n}`)
      expect(replies.map((message) => message.text)).toEqual([`answer to s${n} first`, `answer to s${n} second`])
      const first = stub.requests.find((_, index) => lastUserText(index) === `s${n} first`)!
      const second = stub.requests.find((_, index) => lastUserText(index) === `s${n} second`)!
      expect(second.receivedAt).toBeGreaterThanOrEqual(first.respondedAt!)
      expect(stub.userTexts(second)).toContain(`s${n} first`)
    }
    expect(control.calls.count).toBe(0)
    expect(received).toHaveLength(SESSIONS)
    for (const options of received) {
      expect(options).toMatchObject({
        apiKey: STUB_KEY,
        withheldBuiltinTools: ['shell'],
        memory: { enabled: false },
        local: { cwd: workspace, sessionDir: join(workspace, '.theoclaw') },
      })
    }
  })

  // Failure scenario "model provider: turn fails": the person gets the fallback reply, the lease is
  // released, and the session's next message runs on the same agent.
  it('a turn the model fails gets the fallback reply and the next message of the session runs', { timeout: 30_000 }, async () => {
    const stub = await startModelStub({
      fail: (request) => stub.userTexts(request).at(-1) === 'first',
      reply: () => 'answer',
    })
    const ids: string[] = []
    const { adapters, builders } = fakeBuilders()
    const app = await startTheoClaw({
      env: { ...OPEN_DMS, OPENROUTER_API_KEY: STUB_KEY, THEOCLAW_WORKSPACE: workspace },
      agentFactory: throwingAgentFactory().factory,
      getOrCreate: (id, options) => {
        ids.push(id)
        return Agent.getOrCreate(id, { ...options, model: { id: 'openai/stub', url: stub.url } })
      },
      builders,
      signals: new EventEmitter(),
      exit: vi.fn(),
      streams: [capturingStream()],
    })
    running.push(app)
    await app.loop.ready
    const telegram = adapters.get('telegram')!

    void telegram.deliver(messageEvent('telegram', 'first', 'provider-failure'))
    await waitFor(() => telegram.sent.length === 1, 15_000, 'the fallback reply')
    void telegram.deliver(messageEvent('telegram', 'second', 'provider-failure'))
    await waitFor(() => telegram.sent.length === 2, 15_000, 'the reply to the next message')
    await stub.close()

    expect(telegram.sent[0]!.text).toBe('Something went wrong on my side and I could not finish that.')
    expect(telegram.sent[1]!.text).toBe('answer')
    expect(ids).toEqual(['theoclaw-telegram-dm-provider_dfailure-g0'])
  })

  it('startTheoClaw creates the transcript directory with mode 0700', async () => {
    const app = await startTheoClaw({
      env: { ...OPEN_DMS, THEOCLAW_WORKSPACE: fresh },
      agentFactory: throwingAgentFactory().factory,
      builders: fakeBuilders().builders,
      signals: new EventEmitter(),
      exit: vi.fn(),
      streams: [capturingStream()],
    })
    running.push(app)

    expect(statSync(join(fresh, '.theoclaw')).mode & 0o777).toBe(0o700)
  })

  it("startTheoClaw leaves an existing transcript directory's mode as it was", async () => {
    const workspace = existing
    mkdirSync(join(workspace, '.theoclaw'))
    chmodSync(join(workspace, '.theoclaw'), 0o750)
    const app = await startTheoClaw({
      env: { ...OPEN_DMS, THEOCLAW_WORKSPACE: workspace },
      agentFactory: throwingAgentFactory().factory,
      builders: fakeBuilders().builders,
      signals: new EventEmitter(),
      exit: vi.fn(),
      streams: [capturingStream()],
    })
    running.push(app)

    expect(statSync(join(workspace, '.theoclaw')).mode & 0o777).toBe(0o750)
  })
})

describe('the chat path through composeTheoClaw', () => {
  it('two events from two different sessions sent at once each resolve their own agent id', async () => {
    for (let repetition = 0; repetition < 20; repetition += 1) {
      const gate = deferred<void>()
      const ids: string[] = []
      const { adapters, builders } = fakeBuilders()
      const { loop } = composeTheoClaw({
        env: OPEN_DMS,
        agentFactory: throwingAgentFactory().factory,
        getOrCreate: async (id) => {
          ids.push(id)
          const agent = new FakeAgent({ frames: (text) => [assistant(`answer to ${text}`), finished()], before: gate.promise })
          return Object.assign(agent, { dispose: async () => undefined })
        },
        builders,
        write: () => undefined,
      })
      await loop.ready
      const telegram = adapters.get('telegram')!

      void telegram.deliver(messageEvent('telegram', 'from alice', 'alice'))
      void telegram.deliver(messageEvent('telegram', 'from bob', 'bob'))
      await waitFor(() => ids.length === 2, 1000, 'both sessions to resolve an agent')
      gate.resolve()
      await waitFor(() => telegram.sent.length === 2, 1000, 'both replies')

      expect([...ids].sort()).toEqual(['theoclaw-telegram-dm-alice-g0', 'theoclaw-telegram-dm-bob-g0'])
      expect(telegram.sent.map((message) => [message.channel.id, message.text]).sort()).toEqual([
        ['telegram-channel-alice', 'answer to from alice'],
        ['telegram-channel-bob', 'answer to from bob'],
      ])
      await loop.stopAll()
    }
  })
})
