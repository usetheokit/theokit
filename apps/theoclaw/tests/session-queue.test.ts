import type { MessageEvent } from '@theokit/gateway'
import type { AgentOptions } from '@theokit/sdk'
import { describe, expect, it, vi } from 'vitest'

import { Generations } from '../src/sessions/generations.js'
import { SessionAgents } from '../src/sessions/session-agents.js'
import type { SessionAgent } from '../src/sessions/session-agents.js'
import { createSessionRouter } from '../src/sessions/session-key.js'
import type { SessionSettings } from '../src/sessions/session-settings.js'
import { deferred } from './fakes.js'

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
