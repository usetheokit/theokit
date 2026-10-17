/**
 * `createHandoffConversation` hands a conversation from one agent to another (B-410).
 *
 * Every test drives the REAL `AgentRunner` and reflective loop; only `createSdkAgentStream` is
 * replaced, which is the seam the rest of the suite uses (`runtime-tools.test.ts`). A
 * `streamFactory` would not do: it replaces the adapter and with it the tools, so the transfer tool
 * would never reach the fake. The fake plays the model: per call it reads one script, and to
 * transfer it finds `transfer_to_agent` among the tools it was handed and awaits its handler.
 *
 * Each roster agent carries a marker tool named after it, so a test can prove WHICH compiled agent
 * ran, not only which session id and label the conversation used.
 */
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import type { ZodType } from 'zod'

interface FakeTool {
  readonly name: string
  readonly inputSchema: unknown
  readonly handler: (input: unknown) => string | Promise<string>
}

interface FakeScript {
  /** Transfer-tool calls the fake makes, in order, before it answers. */
  readonly transfers?: readonly { agent: string; note: string }[]
  /** Thrown after the transfers, in place of an answer. */
  readonly throwAfter?: Error
  /** Aborted after the transfers, before the first event. */
  readonly abortAfter?: AbortController
  /** Awaited before anything else, so a test can hold a turn open. */
  readonly hold?: Promise<void>
  /** USD cost reported on the round's `done` event. */
  readonly cost?: number
}

interface FakeCall {
  readonly sessionId: string
  readonly message: string
  readonly toolNames: readonly string[]
  readonly tools: readonly FakeTool[]
  readonly apiKey: unknown
  readonly overrides: Record<string, unknown>
  readonly factoryOpts: { disableTools?: boolean } | undefined
}

const h = vi.hoisted(() => ({ calls: [] as FakeCall[], scripts: [] as FakeScript[] }))

vi.mock('../../src/bridge/sdk-adapter.js', () => ({
  createSdkAgentStream:
    (
      _compiled: unknown,
      tools: readonly FakeTool[],
      apiKey: unknown,
      overrides: Record<string, unknown> = {},
    ) =>
    (
      message: string,
      sessionId: string,
      factoryOpts?: { disableTools?: boolean },
    ): AsyncIterable<{ type: string; [k: string]: unknown }> => {
      h.calls.push({
        sessionId,
        message,
        toolNames: tools.map((t) => t.name),
        tools,
        apiKey,
        overrides,
        factoryOpts,
      })
      const script = h.scripts.shift() ?? {}
      return (async function* () {
        if (script.hold) await script.hold
        for (const transfer of script.transfers ?? []) {
          const tool = tools.find((t) => t.name === 'transfer_to_agent')
          if (!tool) throw new Error('the fake model was not offered transfer_to_agent')
          await tool.handler(transfer)
        }
        if (script.throwAfter) throw script.throwAfter
        script.abortAfter?.abort()
        yield { type: 'text_delta', content: 'ok' }
        yield { type: 'done', ...(script.cost === undefined ? {} : { cost: script.cost }) }
      })()
    },
}))

const { createHandoffConversation, HandoffError } =
  await import('../../src/handoff/handoff-conversation.js')
const { applyCapabilities } = await import('../../src/capability/capability.js')
const { ModelCapability } = await import('../../src/capability/capabilities.js')
const { DelegationBudgetExceededError, DelegationError } =
  await import('../../src/bridge/delegation-types.js')

const base = applyCapabilities([new ModelCapability('test-model')])

function agent(name: string, maxIterations?: number) {
  const marker = {
    name: `${name}_marker`,
    description: `marks ${name}`,
    inputSchema: {},
    handler: () => name,
  }
  return {
    name,
    compiled: { ...base, tools: [marker] },
    ...(maxIterations === undefined ? {} : { maxIterations }),
  }
}

const ROSTER = [agent('triage'), agent('billing'), agent('refunds')]

function conversation() {
  h.calls.length = 0
  h.scripts.length = 0
  return createHandoffConversation({ agents: ROSTER, initial: 'triage', conversationId: 'conv-1' })
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(HandoffError)
    return (error as InstanceType<typeof HandoffError>).code
  }
  return undefined
}

async function rejectionOf(start: () => Promise<unknown>): Promise<unknown> {
  try {
    await start()
  } catch (error) {
    return error
  }
  throw new Error('expected the promise to reject')
}

/** The paragraph a message opens with, which is where the receiver reads the note. */
function leadOf(message: string): string {
  return message.split('\n\n')[0] ?? ''
}

const OPTS = { apiKey: 'k' }

describe('createHandoffConversation', () => {
  it('the next turn is answered by the receiver', async () => {
    const conv = conversation()
    h.scripts.push({ transfers: [{ agent: 'billing', note: 'order 123' }] })

    const first = await conv.send('I want a refund', OPTS)
    const second = await conv.send('it was a gift', OPTS)

    expect(first.responder).toBe('triage')
    expect(first.handoff).toEqual({ from: 'triage', to: 'billing', note: 'order 123' })
    expect(second.responder).toBe('billing')
    expect(conv.responder).toBe('billing')
  })

  it('a handoff to an agent outside the roster throws unknown_agent', () => {
    const conv = conversation()

    expect(codeOf(() => conv.handoffTo('legal'))).toBe('unknown_agent')
    expect(conv.responder).toBe('triage')
    expect(codeOf(() => createHandoffConversation({ agents: ROSTER, initial: 'legal' }))).toBe(
      'unknown_agent',
    )
  })

  it('refuses a roster below two agents or with a duplicate name', () => {
    expect(
      codeOf(() => createHandoffConversation({ agents: [agent('triage')], initial: 'triage' })),
    ).toBe('roster_too_small')
    expect(
      codeOf(() =>
        createHandoffConversation({
          agents: [agent('triage'), agent('triage')],
          initial: 'triage',
        }),
      ),
    ).toBe('duplicate_name')
  })

  it('runs once per send, each agent on its own session', async () => {
    const conv = conversation()
    h.scripts.push({ transfers: [{ agent: 'billing', note: 'n' }] })

    await conv.send('a', OPTS)
    await conv.send('b', OPTS)

    expect(h.calls.map((c) => c.sessionId)).toEqual(['conv-1:triage', 'conv-1:billing'])
    expect(h.calls[1]?.toolNames).toContain('billing_marker')
    expect(h.calls[1]?.toolNames).not.toContain('triage_marker')
  })

  it('a failed turn does not commit the transfer', async () => {
    const conv = conversation()
    const failure = new DelegationError('triage', new Error('provider down'))
    h.scripts.push({ transfers: [{ agent: 'billing', note: 'n' }], throwAfter: failure })

    const error = await rejectionOf(() => conv.send('I want a refund', OPTS))

    expect(error).toBe(failure)
    expect(conv.responder).toBe('triage')
  })

  it('a turn without a transfer keeps the responder', async () => {
    const conv = conversation()

    const first = await conv.send('hello', OPTS)
    await conv.send('again', OPTS)

    expect(first.handoff).toBeUndefined()
    expect(h.calls[1]?.sessionId).toBe('conv-1:triage')
  })

  it('the receiver reads the note before the user message, once', async () => {
    const conv = conversation()
    h.scripts.push({ transfers: [{ agent: 'billing', note: 'order 123 is a gift' }] })

    await conv.send('I want a refund', OPTS)
    await conv.send('what now?', OPTS)
    await conv.send('thanks', OPTS)

    const firstForBilling = h.calls[1]?.message ?? ''
    expect(leadOf(firstForBilling)).toContain('order 123 is a gift')
    expect(firstForBilling.endsWith('what now?')).toBe(true)
    expect(h.calls[2]?.message).not.toContain('order 123 is a gift')
  })

  it('the transfer tool offers only the other agents', async () => {
    const conv = conversation()

    await conv.send('hello', OPTS)

    const tool = h.calls[0]?.tools.find((t) => t.name === 'transfer_to_agent')
    expect(tool, 'transfer_to_agent was not offered').toBeDefined()
    const schema = tool?.inputSchema as ZodType
    expect(schema.safeParse({ agent: 'billing', note: 'n' }).success).toBe(true)
    expect(schema.safeParse({ agent: 'triage', note: 'n' }).success).toBe(false)
    expect(schema.safeParse({ agent: 'legal', note: 'n' }).success).toBe(false)
  })

  it('a programmatic handoff moves the next turn', async () => {
    const conv = conversation()

    conv.handoffTo('billing', 'vip customer')
    await conv.send('hello', OPTS)

    expect(h.calls[0]?.sessionId).toBe('conv-1:billing')
    const message = h.calls[0]?.message ?? ''
    expect(leadOf(message)).toContain('vip customer')
    expect(message.endsWith('hello')).toBe(true)
  })

  it('a send while a turn is running is refused', async () => {
    const conv = conversation()
    const gate = deferred()
    h.scripts.push({ hold: gate.promise })

    const first = conv.send('a', OPTS)
    const second = await rejectionOf(() => conv.send('b', OPTS))
    gate.resolve()
    const result = await first

    expect(second).toBeInstanceOf(HandoffError)
    expect((second as InstanceType<typeof HandoffError>).code).toBe('turn_in_progress')
    expect(result.responder).toBe('triage')
    expect(h.calls).toHaveLength(1)
  })

  it('a handoff while a turn is running is refused', async () => {
    const conv = conversation()
    const gate = deferred()
    h.scripts.push({ hold: gate.promise })

    const first = conv.send('a', OPTS)
    const code = codeOf(() => conv.handoffTo('billing'))
    gate.resolve()
    await first

    expect(code).toBe('turn_in_progress')
    expect(conv.responder).toBe('triage')
  })

  it('the last transfer in a run wins', async () => {
    const conv = conversation()
    h.scripts.push({
      transfers: [
        { agent: 'billing', note: 'first' },
        { agent: 'refunds', note: 'second' },
      ],
    })

    const turn = await conv.send('a', OPTS)

    expect(turn.handoff).toEqual({ from: 'triage', to: 'refunds', note: 'second' })
    expect(conv.responder).toBe('refunds')
  })

  it('a handoff to the current agent changes nothing', async () => {
    const conv = conversation()

    conv.handoffTo('triage', 'ignored')
    await conv.send('hello', OPTS)

    expect(conv.responder).toBe('triage')
    expect(h.calls[0]?.message).toBe('hello')
  })

  it('a cancelled turn does not commit the transfer', async () => {
    const conv = conversation()
    const controller = new AbortController()
    h.scripts.push({ transfers: [{ agent: 'billing', note: 'n' }], abortAfter: controller })

    const turn = await conv.send('I want a refund', { ...OPTS, signal: controller.signal })

    expect(turn.handoff).toBeUndefined()
    expect(conv.responder).toBe('triage')
  })

  it('a pre-aborted send keeps the waiting note', async () => {
    const conv = conversation()
    h.scripts.push({ transfers: [{ agent: 'billing', note: 'order 123' }] })
    const controller = new AbortController()
    controller.abort()

    await conv.send('I want a refund', OPTS)
    await conv.send('ignored', { ...OPTS, signal: controller.signal })
    await conv.send('it was a gift', OPTS)

    expect(h.calls).toHaveLength(2)
    expect(h.calls[1]?.sessionId).toBe('conv-1:billing')
    const message = h.calls[1]?.message ?? ''
    expect(leadOf(message)).toContain('order 123')
    expect(message.endsWith('it was a gift')).toBe(true)
  })

  it('refuses a roster agent whose step ceiling is 1', () => {
    expect(
      codeOf(() =>
        createHandoffConversation({
          agents: [agent('triage'), agent('billing', 1)],
          initial: 'triage',
        }),
      ),
    ).toBe('step_ceiling_too_low')
  })

  it('the run options reach the selected runner and the owned ones do not', async () => {
    const conv = conversation()
    conv.handoffTo('billing')
    h.scripts.push({ cost: 1 })
    const unusedFactory = vi.fn()
    // A non-literal object: `Omit` rejects these fields only in a fresh literal, so the
    // conversation must drop them at run time as well.
    const smuggled = {
      apiKey: 'key-for-billing',
      model: 'model-for-billing',
      budget: 0.5,
      sessionId: 'not-the-conversation',
      tools: [],
      streamFactory: unusedFactory,
      maxIterations: 1,
    }

    const error = await rejectionOf(() => conv.send('hello', smuggled))

    expect(error).toBeInstanceOf(DelegationBudgetExceededError)
    expect(unusedFactory).not.toHaveBeenCalled()
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]?.sessionId).toBe('conv-1:billing')
    expect(h.calls[0]?.apiKey).toBe('key-for-billing')
    expect(h.calls[0]?.overrides.model).toBe('model-for-billing')
    expect(h.calls[0]?.toolNames).toHaveLength(2)
    expect(h.calls[0]?.toolNames).toEqual(
      expect.arrayContaining(['billing_marker', 'transfer_to_agent']),
    )
    expect(h.calls[0]?.factoryOpts?.disableTools).not.toBe(true)
  })
})
