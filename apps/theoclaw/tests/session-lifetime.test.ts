import type { MessageEvent } from '@theokit/gateway'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { composeTheoClaw } from '../src/composition.js'
import { Generations } from '../src/sessions/generations.js'
import { SessionAgents } from '../src/sessions/session-agents.js'
import type { SessionAgent } from '../src/sessions/session-agents.js'
import { createSessionRouter } from '../src/sessions/session-key.js'
import type { SessionSettings } from '../src/sessions/session-settings.js'
import { fakeBuilders, OPEN_DMS } from './composition-fixtures.js'
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

/** Generations whose next move waits for `held`, so a test can act while a reset is still writing. */
function heldGenerations(held: Promise<void>): Generations {
  const counts = new Map<string, number>()
  return {
    current: (key: string) => counts.get(key) ?? 0,
    next: async (key: string) => {
      await held
      const generation = (counts.get(key) ?? 0) + 1
      counts.set(key, generation)
      return generation
    },
  } as unknown as Generations
}

describe('SessionAgents reset', () => {
  it("a reset with no turn in flight disposes the old generation's agent", async () => {
    const { sessions, built } = harness()
    ;(await sessions.lease(dm('u1'))).release()

    await sessions.reset(dm('u1'))
    await Promise.resolve()

    expect(built.map((agent) => [agent.id, agent.disposes])).toEqual([['theoclaw-telegram-dm-u1-g0', 1]])
  })

  it('a reset during a turn disposes the old agent only once its lease is released', async () => {
    const { sessions, built } = harness()
    const lease = await sessions.lease(dm('u1'))

    await sessions.reset(dm('u1'))
    await Promise.resolve()
    expect(built[0]?.disposes).toBe(0)
    lease.release()
    await Promise.resolve()
    expect(built[0]?.disposes).toBe(1)

    ;(await sessions.lease(dm('u1'))).release()
    expect(built.map((agent) => agent.id)).toEqual(['theoclaw-telegram-dm-u1-g0', 'theoclaw-telegram-dm-u1-g1'])
  })

  it('a message sent while a reset is still moving the generation runs on the new generation', async () => {
    const write = deferred<void>()
    const getOrCreate = vi.fn(async (id: string) => new CountingAgent(id))
    const sessions = new SessionAgents({
      router: createSessionRouter(settings()),
      getOrCreate,
      optionsFor: () => ({ model: 'stub' }),
      generations: heldGenerations(write.promise),
      settings: settings(),
      write: () => undefined,
    })

    const reset = sessions.reset(dm('u1'))
    const lease = sessions.lease(dm('u1'))
    write.resolve()
    await reset
    ;(await lease).release()

    expect(getOrCreate.mock.calls.map(([id]) => id)).toEqual(['theoclaw-telegram-dm-u1-g1'])
  })

  it('a reset whose write fails still lets the next message run on the generation it kept', async () => {
    const write = deferred<void>()
    const getOrCreate = vi.fn(async (id: string) => new CountingAgent(id))
    const sessions = new SessionAgents({
      router: createSessionRouter(settings()),
      getOrCreate,
      optionsFor: () => ({ model: 'stub' }),
      generations: heldGenerations(write.promise),
      settings: settings(),
      write: () => undefined,
    })

    const reset = sessions.reset(dm('u1')).catch((error: unknown) => error)
    const lease = sessions.lease(dm('u1'))
    write.reject(new Error('disk full'))

    expect(await reset).toEqual(new Error('disk full'))
    ;(await lease).release()
    expect(getOrCreate.mock.calls.map(([id]) => id)).toEqual(['theoclaw-telegram-dm-u1-g0'])
  })
})

describe('SessionAgents stopping', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a resolve that fails while stopping does not hold the stop for 30 s', async () => {
    const resolving = deferred<SessionAgent>()
    const sessions = new SessionAgents({
      router: createSessionRouter(settings()),
      getOrCreate: () => resolving.promise,
      optionsFor: () => ({ model: 'stub' }),
      generations: new Generations(),
      settings: settings(),
      write: () => undefined,
    })
    const lease = sessions.lease(dm('u1')).catch((error: unknown) => error)
    let stopped = false
    const stopping = sessions.disposeAll().then(() => {
      stopped = true
    })

    resolving.reject(new Error('provider down'))
    await lease
    await vi.advanceTimersByTimeAsync(0)

    expect(stopped).toBe(true)
    await stopping
  })

  it('two stops at once both end when the last turn is released', async () => {
    const { sessions } = harness()
    const lease = await sessions.lease(dm('u1'))
    let stopped = 0
    const first = sessions.disposeAll().then(() => (stopped += 1))
    const second = sessions.disposeAll().then(() => (stopped += 1))

    await vi.advanceTimersByTimeAsync(1000)
    lease.release()
    await vi.advanceTimersByTimeAsync(0)

    expect(stopped).toBe(2)
    await Promise.all([first, second])
  })

  it('refuses a lease that waited on a dispose while stopping began, and opens no agent', async () => {
    const hold = deferred<void>()
    const { sessions, getOrCreate } = harness({}, hold.promise)
    ;(await sessions.lease(dm('u1'))).release()
    await vi.advanceTimersByTimeAsync(31 * MINUTE)

    const waiting = sessions.lease(dm('u1')).catch((error: unknown) => error)
    const stopping = sessions.disposeAll()
    hold.resolve()
    await stopping

    expect(await waiting).toEqual(new Error('theoclaw is stopping: no new chat turn starts'))
    expect(getOrCreate).toHaveBeenCalledTimes(1)
  })

  it('refuses a lease that waited on a reset while stopping began, and opens no agent', async () => {
    const write = deferred<void>()
    const getOrCreate = vi.fn(async (id: string) => new CountingAgent(id))
    const sessions = new SessionAgents({
      router: createSessionRouter(settings()),
      getOrCreate,
      optionsFor: () => ({ model: 'stub' }),
      generations: heldGenerations(write.promise),
      settings: settings(),
      write: () => undefined,
    })

    const reset = sessions.reset(dm('u1'))
    const waiting = sessions.lease(dm('u1')).catch((error: unknown) => error)
    const stopping = sessions.disposeAll()
    write.resolve()
    await reset
    await stopping

    expect(await waiting).toEqual(new Error('theoclaw is stopping: no new chat turn starts'))
    expect(getOrCreate).not.toHaveBeenCalled()
  })

  it('a dispose that fails is logged naming the session, and the session reopens on its next message', async () => {
    const failing = Promise.reject(new Error('socket closed'))
    failing.catch(() => undefined)
    const { sessions, built, lines, getOrCreate } = harness({}, failing)
    ;(await sessions.lease(dm('u1'))).release()

    await vi.advanceTimersByTimeAsync(31 * MINUTE)
    ;(await sessions.lease(dm('u1'))).release()

    expect(built[0]?.disposes).toBe(1)
    expect(lines).toEqual(['theoclaw: disposing the agent of session telegram-dm-u1 failed: socket closed'])
    expect(getOrCreate).toHaveBeenCalledTimes(2)
  })

  it('refuses a lease once stopping has begun', async () => {
    const { sessions, getOrCreate } = harness()
    await sessions.disposeAll()

    await expect(sessions.lease(dm('u1'))).rejects.toThrow('stopping')
    expect(getOrCreate).toHaveBeenCalledTimes(0)
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
      env: OPEN_DMS,
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

/**
 * An agent shaped like `@theokit/sdk` 5.11's: the request boundary would tear it down through
 * `Symbol.asyncDispose`, and `SessionAgents` disposes it through `dispose()`.
 */
class SdkShapedAgent extends FakeAgent {
  teardowns = 0
  disposes = 0

  async [Symbol.asyncDispose](): Promise<void> {
    this.teardowns += 1
  }

  async dispose(): Promise<void> {
    this.disposes += 1
  }
}

describe("a chat reply's request boundary leaves its session's agent open", () => {
  it('does not dispose the leased agent after a turn', async () => {
    const agent = new SdkShapedAgent({ frames: [assistant('Hi!'), finished()] })
    let resolved = 0
    const { adapters, builders } = fakeBuilders()
    const { loop } = composeTheoClaw({
      env: OPEN_DMS,
      agentFactory: () => {
        throw new Error('the /control factory must not build a chat agent')
      },
      getOrCreate: async () => {
        resolved += 1
        return agent
      },
      builders,
      write: () => undefined,
    })
    await loop.ready

    const telegram = adapters.get('telegram')!
    await telegram.deliver(messageEvent('telegram', 'hello'))
    await waitFor(() => telegram.sent.length === 1, 1000, 'the reply to be sent')

    expect(telegram.sent.map((message) => message.text)).toEqual(['Hi!'])
    expect(agent.teardowns).toBe(0)
    expect(agent.disposes).toBe(0)
    expect(resolved).toBe(1)
    await loop.stopAll()
  })
})
