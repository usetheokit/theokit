import 'reflect-metadata'

import { describe, expect, it } from 'vitest'

import { GatewayRunner, channelRendering } from '@theokit/gateway'
import type { GatewayContext, GatewayHandler, MessageEvent, SendResult } from '@theokit/gateway'
import type { SDKAgent } from '@theokit/sdk'

import {
  AgentTurnError,
  NO_ANSWER_REPLY,
  ReplyDeliveryError,
  createReplyHandler,
} from '../src/channels/reply-handler.js'
import type { TurnAgent } from '../src/channels/reply-handler.js'
import { composeTheoClaw, createContainer } from '../src/composition.js'
import type { SessionLease } from '../src/sessions/session-agents.js'
import { fakeBuilders, TELEGRAM_AND_LINE } from './composition-fixtures.js'
import { FakeAdapter, FakeAgent, assistant, deferred, finished, messageEvent, thinking, waitFor } from './fakes.js'
import type { FakeTurn } from './fakes.js'

/** The presenter's fixed sentence for a turn that failed before any text (`@theokit/presenter`). */
const ERROR_SENTENCE = 'Something went wrong on my side and I could not finish that.'

interface Reply {
  readonly text: string
  readonly format: string | undefined
}

function fakeContext(
  event: MessageEvent,
  result: SendResult = { ok: true, messageId: 'm-1' },
): { ctx: GatewayContext; replies: Reply[] } {
  const replies: Reply[] = []
  const ctx: GatewayContext = {
    event,
    reply: async (text, opts) => {
      replies.push({ text, format: opts?.format })
      return result
    },
  }
  return { ctx, replies }
}

/** One lease of `agent` per call, as the composition root's chat boundary hands out. */
function withOne(agent: TurnAgent) {
  return async <R>(_event: MessageEvent, work: (lease: SessionLease) => R | Promise<R>): Promise<R> =>
    work({ agent, release: () => undefined })
}

/**
 * The real agent fits the port the reply handler takes, checked by `tsc -p tsconfig.test.json`
 * (the app's `typecheck`). Typed with the presenter's `SdkMessage`, whose index signature the
 * SDK's message interfaces do not declare, the port refused it with TS2322 (Codex finding
 * `pj_turn_agent_port_rejects_sdk_agent`).
 */
export const realAgentFitsThePort = (agent: SDKAgent): TurnAgent => agent

describe('createReplyHandler', () => {
  it('replies once per turn with no reasoning text', async () => {
    const agent = new FakeAgent({ frames: [thinking('The'), assistant('Hi!'), finished()] })
    const event = messageEvent('telegram', 'hello')
    const { ctx, replies } = fakeContext(event)

    await createReplyHandler({ withAgent: withOne(agent) })(event, ctx)

    expect(replies).toHaveLength(1)
    expect(replies[0]?.text).toBe('Hi!')
    expect(replies[0]?.text).not.toContain('The')
    expect(agent.sent).toEqual(['hello'])
  })

  it('skips a message with empty text', async () => {
    let boundaries = 0
    const event = messageEvent('telegram', '  ')
    const { ctx, replies } = fakeContext(event)

    await createReplyHandler({
      withAgent: async () => {
        boundaries += 1
        throw new Error('no boundary should open')
      },
    })(event, ctx)

    expect(replies).toHaveLength(0)
    expect(boundaries).toBe(0)
  })

  it('answers with the error sentence and rethrows when the agent fails', async () => {
    const failure = new Error('provider unreachable')
    const agent = new FakeAgent({ frames: [], streamError: failure })
    const event = messageEvent('discord', 'hello')
    const { ctx, replies } = fakeContext(event)

    await expect(createReplyHandler({ withAgent: withOne(agent) })(event, ctx)).rejects.toBe(failure)

    expect(replies.map((reply) => reply.text)).toEqual([ERROR_SENTENCE])
  })

  it('sends the partial text once and rethrows when the agent fails after text', async () => {
    const failure = new Error('stream cut')
    const agent = new FakeAgent({ frames: [assistant('Half an ans')], streamError: failure })
    const event = messageEvent('slack', 'hello')
    const { ctx, replies } = fakeContext(event)

    await expect(createReplyHandler({ withAgent: withOne(agent) })(event, ctx)).rejects.toBe(failure)

    expect(replies.map((reply) => reply.text)).toEqual(['Half an ans'])
  })

  it('replies once with the fallback for a reasoning-only turn', async () => {
    const agent = new FakeAgent({ frames: [thinking('Let me think'), finished()] })
    const event = messageEvent('matrix', 'hello')
    const { ctx, replies } = fakeContext(event)

    await createReplyHandler({ withAgent: withOne(agent) })(event, ctx)

    expect(replies.map((reply) => reply.text)).toEqual([NO_ANSWER_REPLY])
  })

  it('a run that resolves with error status replies once and rethrows', async () => {
    const agent = new FakeAgent({
      frames: [],
      result: { status: 'error', error: { code: 'provider_error' } },
    })
    const event = messageEvent('mattermost', 'hello')
    const { ctx, replies } = fakeContext(event)

    const turn = createReplyHandler({ withAgent: withOne(agent) })(event, ctx)

    await expect(turn).rejects.toBeInstanceOf(AgentTurnError)
    await expect(turn).rejects.toThrow(/mattermost.*provider_error/)
    expect(replies.map((reply) => reply.text)).toEqual([ERROR_SENTENCE])
  })

  it('a cancelled run is not a failure', async () => {
    const agent = new FakeAgent({ frames: [], result: { status: 'cancelled' } })
    const event = messageEvent('email', 'hello')
    const { ctx, replies } = fakeContext(event)

    await createReplyHandler({ withAgent: withOne(agent) })(event, ctx)

    expect(replies.map((reply) => reply.text)).toEqual([NO_ANSWER_REPLY])
  })

  it('an agent factory that rejects still replies once', async () => {
    const failure = new Error('THEOCLAW_MODEL is not a known model')
    const event = messageEvent('line', 'hello')
    const { ctx, replies } = fakeContext(event)

    await expect(
      createReplyHandler({ withAgent: () => Promise.reject(failure) })(event, ctx),
    ).rejects.toBe(failure)

    expect(replies.map((reply) => reply.text)).toEqual([ERROR_SENTENCE])
  })

  it('a failed send throws a typed error naming the platform', async () => {
    const agent = new FakeAgent({ frames: [assistant('Hi!'), finished()] })
    const event = messageEvent('telegram', 'hello')
    const { ctx } = fakeContext(event, {
      ok: false,
      error: { code: 'rate_limited', message: 'slow down' },
    })

    const turn = createReplyHandler({ withAgent: withOne(agent) })(event, ctx)

    await expect(turn).rejects.toBeInstanceOf(ReplyDeliveryError)
    await expect(turn).rejects.toThrow(/telegram.*rate_limited/)
  })

  it("replies in the platform's rendering", async () => {
    const agent = new FakeAgent({ frames: [assistant('**Hi**'), finished()] })
    const event = messageEvent('line', 'hello')
    const { ctx, replies } = fakeContext(event)

    await createReplyHandler({ withAgent: withOne(agent) })(event, ctx)

    expect(replies).toEqual([
      { text: channelRendering('line').translate('**Hi**'), format: channelRendering('line').format },
    ])
  })

  it('a reply that throws is attempted once and rethrown', async () => {
    const agent = new FakeAgent({ frames: [assistant('Hi!'), finished()] })
    const event = messageEvent('telegram', 'hello')
    const unreachable = new Error('connection reset')
    let attempts = 0
    const ctx: GatewayContext = {
      event,
      reply: async () => {
        attempts += 1
        throw unreachable
      },
    }

    await expect(createReplyHandler({ withAgent: withOne(agent) })(event, ctx)).rejects.toBe(unreachable)

    expect(attempts).toBe(1)
  })

  it('a boundary that fails after the turn replied does not reply again', async () => {
    const agent = new FakeAgent({ frames: [assistant('Hi!'), finished()] })
    const event = messageEvent('telegram', 'hello')
    const { ctx, replies } = fakeContext(event)
    const disposal = new Error('request scope disposal failed')

    const turn = createReplyHandler({
      withAgent: async (_event, work) => {
        await work({ agent, release: () => undefined })
        throw disposal
      },
    })(event, ctx)

    await expect(turn).rejects.toBe(disposal)
    expect(replies.map((reply) => reply.text)).toEqual(['Hi!'])
  })

  it('a refused reply after a failed turn keeps the turn failure as its cause', async () => {
    const failure = new Error('provider unreachable')
    const agent = new FakeAgent({ frames: [], streamError: failure })
    const event = messageEvent('telegram', 'hello')
    const { ctx } = fakeContext(event, { ok: false, error: { code: 'rate_limited', message: 'slow' } })

    const turn = createReplyHandler({ withAgent: withOne(agent) })(event, ctx)

    await expect(turn).rejects.toBeInstanceOf(ReplyDeliveryError)
    await expect(turn).rejects.toHaveProperty('cause', failure)
  })

  it('a reply that throws after a failed turn reports both errors', async () => {
    const failure = new Error('provider unreachable')
    const unreachable = new Error('connection reset')
    const agent = new FakeAgent({ frames: [], streamError: failure })
    const event = messageEvent('telegram', 'hello')
    const ctx: GatewayContext = {
      event,
      reply: async () => {
        throw unreachable
      },
    }

    const turn = createReplyHandler({ withAgent: withOne(agent) })(event, ctx)

    await expect(turn).rejects.toBeInstanceOf(AggregateError)
    await expect(turn).rejects.toHaveProperty('errors', [failure, unreachable])
  })

  it('a refused reply after the factory failed keeps the factory error as its cause', async () => {
    const failure = new Error('THEOCLAW_MODEL is not a known model')
    const event = messageEvent('telegram', 'hello')
    const { ctx } = fakeContext(event, { ok: false, error: { code: 'rate_limited', message: 'slow' } })

    const turn = createReplyHandler({ withAgent: () => Promise.reject(failure) })(event, ctx)

    await expect(turn).rejects.toBeInstanceOf(ReplyDeliveryError)
    await expect(turn).rejects.toHaveProperty('cause', failure)
  })

  it('an error status in the stream fails the turn even when the run reports finished', async () => {
    const agent = new FakeAgent({
      frames: [{ type: 'status', status: 'ERROR', message: 'model overloaded' }],
      result: { status: 'finished' },
    })
    const event = messageEvent('telegram', 'hello')
    const { ctx, replies } = fakeContext(event)

    const turn = createReplyHandler({ withAgent: withOne(agent) })(event, ctx)

    await expect(turn).rejects.toBeInstanceOf(AgentTurnError)
    expect(replies.map((reply) => reply.text)).toEqual([ERROR_SENTENCE])
  })

  describe('concurrency', () => {
    it('two turns at once each get their own reply and their own agent', async () => {
      const gate = deferred<void>()
      const built: FakeAgent[] = []
      const composition = createContainer<TurnAgent>({
        factory: () => {
          const agent = new FakeAgent({
            frames: (text) => [assistant(`answer to ${text}`), finished()],
            before: gate.promise,
          })
          built.push(agent)
          return agent
        },
      })
      const handler = createReplyHandler({
        withAgent: (_event, work) => composition.withAgent((agent) => work({ agent, release: () => undefined })),
      })
      const first = messageEvent('telegram', 'one', 'user-1')
      const second = messageEvent('telegram', 'two', 'user-2')
      const one = fakeContext(first)
      const two = fakeContext(second)

      const turns = Promise.all([handler(first, one.ctx), handler(second, two.ctx)])
      // Both turns are inside their boundaries, each with its own agent, before either streams.
      await waitFor(
        () => built.length === 2 && built.every((agent) => agent.sent.length === 1),
        1000,
        'both turns to have sent to their own agent',
      )
      gate.resolve()
      await turns

      expect(built).toHaveLength(2)
      expect(built[0]).not.toBe(built[1])
      expect(one.replies.map((reply) => reply.text)).toEqual(['answer to one'])
      expect(two.replies.map((reply) => reply.text)).toEqual(['answer to two'])
    })
  })
})

/**
 * The handler inside a real `GatewayRunner`, over a FakeAdapter: what the plan's failure scenarios
 * name at the platform's edge (the adapter's `sendMessage`, the runner's `on_error` hook) rather than
 * at the `ctx.reply` seam the tests above use.
 */
describe('createReplyHandler in a GatewayRunner', () => {
  async function runOne(
    adapter: FakeAdapter,
    handler: GatewayHandler,
    text: string,
  ): Promise<readonly Error[]> {
    const errors: Error[] = []
    const runner = new GatewayRunner({
      adapters: [adapter],
      handler,
      hooks: [{ name: 'record', on_error: ({ error }) => void errors.push(error) }],
    })
    await runner.start()
    await adapter.deliver(messageEvent(adapter.platform, text))
    await waitFor(() => errors.length > 0, 1000, 'the runner to fire on_error')
    await runner.stop()
    return errors
  }

  it('a sendMessage refused by the platform reaches on_error as ReplyDeliveryError', async () => {
    const adapter = new FakeAdapter('telegram', {
      send: async () => ({ ok: false, error: { code: 'rate_limited', message: 'slow down' } }),
    })
    const agent = new FakeAgent({ frames: [assistant('hi'), finished()] })

    const errors = await runOne(adapter, createReplyHandler({ withAgent: withOne(agent) }), 'hello')

    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(ReplyDeliveryError)
    expect(errors[0]?.message).toBe('telegram: reply was not delivered (rate_limited)')
    expect(adapter.sent.map((message) => message.text)).toEqual(['hi'])
  })

  it('a turn that rejects mid-stream sends its partial text and reaches on_error', async () => {
    const failure = new Error('model provider dropped the stream')
    const adapter = new FakeAdapter('telegram')
    const agent = new FakeAgent({ frames: [assistant('Half an ans')], streamError: failure })

    const errors = await runOne(adapter, createReplyHandler({ withAgent: withOne(agent) }), 'hello')

    expect(errors).toEqual([failure])
    expect(adapter.sent.map((message) => message.text)).toEqual(['Half an ans'])
  })
})

/**
 * An agent shaped like `@theokit/sdk` 5.11's local `Agent`: `close()` only marks it disposed, and
 * `[Symbol.asyncDispose]()` runs the session teardown unless that mark is already set. A reply that
 * calls `close()` inside the request boundary therefore skips the teardown and leaks the session.
 */
class SdkShapedAgent extends FakeAgent {
  teardowns = 0
  private disposed = false

  constructor(
    turn: FakeTurn,
    private readonly disposeError?: Error,
  ) {
    super(turn)
  }

  disposes = 0

  close(): void {
    this.disposed = true
  }

  /** `SessionAgents`' own disposal; the request boundary must never call it on a leased agent. */
  async dispose(): Promise<void> {
    this.disposes += 1
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.teardowns += 1
    if (this.disposeError !== undefined) throw this.disposeError
  }
}

/**
 * The reply handler over `createContainer`'s request boundary, which builds and tears down one agent
 * per request. The `/control` socket's turns still run on it (`startTheoClaw`); the chat path no
 * longer does (it leases a session's agent, below).
 */
function handlerOver(agent: SdkShapedAgent): GatewayHandler {
  const agents = createContainer<TurnAgent>({ factory: () => agent })
  return createReplyHandler({
    withAgent: (_event, work) => agents.withAgent((turnAgent) => work({ agent: turnAgent, release: () => undefined })),
  })
}

describe("the /control request boundary tears its agent down", () => {
  it("runs the agent's teardown once after a finished turn", async () => {
    const agent = new SdkShapedAgent({ frames: [assistant('Hi!'), finished()] })
    const event = messageEvent('telegram', 'hello')
    const { ctx, replies } = fakeContext(event)

    await handlerOver(agent)(event, ctx)

    expect(replies.map((reply) => reply.text)).toEqual(['Hi!'])
    expect(agent.teardowns).toBe(1)
  })

  it("runs the agent's teardown once after a turn whose stream rejects", async () => {
    const failure = new Error('provider unreachable')
    const agent = new SdkShapedAgent({ frames: [], streamError: failure })
    const event = messageEvent('telegram', 'hello')
    const { ctx } = fakeContext(event)

    await expect(handlerOver(agent)(event, ctx)).rejects.toBe(failure)

    expect(agent.teardowns).toBe(1)
  })

  it('a teardown that throws after a good turn fails the turn once the reply is sent', async () => {
    const teardown = new Error('session store unavailable')
    const agent = new SdkShapedAgent({ frames: [assistant('Hi!'), finished()] }, teardown)
    const event = messageEvent('telegram', 'hello')
    const { ctx, replies } = fakeContext(event)

    // `@theokit/di` reports a failed request-scope disposal as an AggregateError of each failure.
    await expect(handlerOver(agent)(event, ctx)).rejects.toHaveProperty('errors', [teardown])

    expect(replies.map((reply) => reply.text)).toEqual(['Hi!'])
  })
})

describe("a chat reply's request boundary leaves its session's agent open", () => {
  it('does not dispose the leased agent after a turn', async () => {
    const agent = new SdkShapedAgent({ frames: [assistant('Hi!'), finished()] })
    let resolved = 0
    const { adapters, builders } = fakeBuilders()
    const { loop } = composeTheoClaw({
      env: TELEGRAM_AND_LINE,
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

    expect(adapters.get('telegram')!.sent.map((message) => message.text)).toEqual(['Hi!'])
    expect(agent.teardowns).toBe(0)
    expect(agent.disposes).toBe(0)
    expect(resolved).toBe(1)
    await loop.stopAll()
  })
})
