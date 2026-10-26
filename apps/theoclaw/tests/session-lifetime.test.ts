import type { MessageEvent } from '@theokit/gateway'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { composeTheoClaw } from '../src/composition.js'
import { Generations } from '../src/sessions/generations.js'
import { SessionAgents } from '../src/sessions/session-agents.js'
import type { SessionAgent } from '../src/sessions/session-agents.js'
import { createSessionRouter } from '../src/sessions/session-key.js'
import type { SessionSettings } from '../src/sessions/session-settings.js'
import { fakeBuilders, TELEGRAM_AND_LINE } from './composition-fixtures.js'
import { FakeAgent, assistant, deferred, finished, messageEvent, waitFor } from './fakes.js'

const MINUTE = 60_000

function settings(overrides: Partial<SessionSettings> = {}): SessionSettings {
  return {
    dmScope: 'per-channel-peer',
    peerLinks: new Map(),
    workspace: '/srv/theoclaw',
    idleMinutes: 30,
    maxOpenSessions: 200,
    ...overrides,
  }
}

function dm(sender: string): MessageEvent {
  return messageEvent('telegram', 'hi', sender)
}

/** An agent that counts its disposals; `hold` keeps a disposal pending until the test settles it. */
class CountingAgent implements SessionAgent {
  disposes = 0
  constructor(
    readonly id: string,
    private readonly hold?: Promise<void>,
  ) {}

  send(): never {
    throw new Error('no turn in these tests')
  }

  async dispose(): Promise<void> {
    this.disposes += 1
    await this.hold
  }
}

function harness(overrides: Partial<SessionSettings> = {}, hold?: Promise<void>) {
  const built: CountingAgent[] = []
  const lines: string[] = []
  const getOrCreate = vi.fn(async (id: string) => {
    const agent = new CountingAgent(id, hold)
    built.push(agent)
    return agent
  })
  const sessions = new SessionAgents({
    router: createSessionRouter(settings(overrides)),
    getOrCreate,
    optionsFor: () => ({ model: 'stub' }),
    generations: new Generations(),
    settings: settings(overrides),
    write: (line) => lines.push(line),
  })
  const disposed = (): string[] => built.filter((agent) => agent.disposes > 0).map((agent) => agent.id)
  return { sessions, built, lines, getOrCreate, disposed }
}

describe('SessionAgents lifetime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('disposes an idle agent within 60 s after THEOCLAW_SESSION_IDLE_MINUTES', async () => {
    const { sessions, built } = harness()
    ;(await sessions.lease(dm('u1'))).release()

    await vi.advanceTimersByTimeAsync(30 * MINUTE - 1000)
    expect(built[0]?.disposes).toBe(0)
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(built[0]?.disposes).toBe(1)
  })

  it('never disposes an agent with a turn in flight', async () => {
    const { sessions, built } = harness()
    const lease = await sessions.lease(dm('u1'))

    await vi.advanceTimersByTimeAsync(120 * MINUTE)

    expect(built[0]?.disposes).toBe(0)
    lease.release()
  })

  it('a lease taken just before the sweep makes the sweep skip that agent', async () => {
    const { sessions, built } = harness()
    ;(await sessions.lease(dm('u1'))).release()
    await vi.advanceTimersByTimeAsync(30 * MINUTE + 1000)
    expect(built[0]?.disposes).toBe(1)

    ;(await sessions.lease(dm('u2'))).release()
    await vi.advanceTimersByTimeAsync(30 * MINUTE - 1000)
    const held = sessions.lease(dm('u2'))
    await vi.advanceTimersByTimeAsync(2 * MINUTE)

    expect(built[1]?.disposes).toBe(0)
    ;(await held).release()
  })

  it('disposes the least recently used idle agent above THEOCLAW_MAX_OPEN_SESSIONS', async () => {
    const { sessions, disposed } = harness({ maxOpenSessions: 2 })
    ;(await sessions.lease(dm('a'))).release()
    ;(await sessions.lease(dm('b'))).release()
    ;(await sessions.lease(dm('a'))).release()
    ;(await sessions.lease(dm('c'))).release()
    await vi.advanceTimersByTimeAsync(0)

    expect(disposed()).toEqual(['theoclaw-telegram-dm-b-g0'])
  })

  it('trims the least recently used agent once busy sessions above the bound are released', async () => {
    const { sessions, disposed, lines } = harness({ maxOpenSessions: 2 })
    const a = await sessions.lease(dm('a'))
    const b = await sessions.lease(dm('b'))
    const c = await sessions.lease(dm('c'))
    expect(disposed()).toEqual([])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('THEOCLAW_MAX_OPEN_SESSIONS')

    a.release()
    b.release()
    c.release()
    await vi.advanceTimersByTimeAsync(0)

    expect(disposed()).toEqual(['theoclaw-telegram-dm-a-g0'])
  })

  it('a lease during a held dispose resolves only after the dispose settles', async () => {
    const hold = deferred<void>()
    const { sessions, built, getOrCreate } = harness({}, hold.promise)
    ;(await sessions.lease(dm('u1'))).release()
    await vi.advanceTimersByTimeAsync(31 * MINUTE)
    expect(built[0]?.disposes).toBe(1)

    let resolved = false
    const next = sessions.lease(dm('u1')).then((lease) => {
      resolved = true
      return lease
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(resolved).toBe(false)
    expect(getOrCreate).toHaveBeenCalledTimes(1)

    hold.resolve()
    const lease = await next
    expect(getOrCreate).toHaveBeenCalledTimes(2)
    expect(lease.agent).toBe(built[1])
  })

  it('disposes every open agent when TheoClaw stops', async () => {
    const { sessions, built } = harness()
    ;(await sessions.lease(dm('a'))).release()
    ;(await sessions.lease(dm('b'))).release()

    await sessions.disposeAll()

    expect(built.map((agent) => agent.disposes)).toEqual([1, 1])
  })

  it('stopping waits for a held lease, and disposes one held past 30 s naming its key', async () => {
    const { sessions, built, lines } = harness()
    const short = await sessions.lease(dm('short'))
    const long = await sessions.lease(dm('long'))

    let stopped = false
    const stopping = sessions.disposeAll().then(() => {
      stopped = true
    })
    await vi.advanceTimersByTimeAsync(1000)
    short.release()
    await vi.advanceTimersByTimeAsync(1000)
    expect(built.map((agent) => agent.disposes)).toEqual([0, 0])
    expect(stopped).toBe(false)

    await vi.advanceTimersByTimeAsync(29_000)
    await stopping
    expect(built.map((agent) => agent.disposes)).toEqual([1, 1])
    expect(lines.filter((line) => line.includes('telegram-dm-long'))).toHaveLength(1)
    long.release()
  })
})

describe('the chat request boundary and the session agent', () => {
  it('the request container does not dispose a session agent across 3 messages', async () => {
    const agent = Object.assign(new FakeAgent({ frames: [assistant('ok'), finished()] }), {
      disposes: 0,
      async dispose(this: { disposes: number }) {
        this.disposes += 1
      },
    })
    const { adapters, builders } = fakeBuilders()
    const { loop } = composeTheoClaw({
      env: TELEGRAM_AND_LINE,
      agentFactory: () => {
        throw new Error('the /control factory must not build a chat agent')
      },
      getOrCreate: async () => agent,
      builders,
      write: () => undefined,
    })
    await loop.ready
    const telegram = adapters.get('telegram')!

    for (const text of ['one', 'two', 'three']) {
      await telegram.deliver(messageEvent('telegram', text))
      await waitFor(() => agent.sent.length === ['one', 'two', 'three'].indexOf(text) + 1 && telegram.sent.length === agent.sent.length, 1000, `the reply to ${text}`)
    }

    expect(agent.sent).toEqual(['one', 'two', 'three'])
    expect(agent.disposes).toBe(0)
    await loop.stopAll()
  })
})
