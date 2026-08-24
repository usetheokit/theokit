/**
 * theokit#363 — a declared step ceiling REACHES the SDK on the served path.
 *
 * The defect this pins is not "the helper computes the wrong number" — it is that the number never
 * arrived. `CompiledAgentOptions.maxIterations` was written by every authoring surface and read by
 * none of them once the agent was served: the only code that enforced a ceiling
 * (`runReflectiveLoop`) has zero call sites under `packages/theo/src`. A unit test of a pure helper
 * would have been green against that.
 *
 * So these tests capture what actually crosses the SDK boundary. Only `@theokit/sdk` is mocked; the
 * real `createSdkAgentStream` / `streamAgentUIMessages` / `toAgentFactory` run, and the assertion is
 * on the `SendOptions` the SDK's `send()` received — the same object the SDK's agent loop reads
 * `maxIterations` off to size its `IterationBudget`.
 *
 * They fail against the pre-fix adapter: `sendOptions` carried only `toolChoice`/`onRunEvent`, so
 * `captured.send.maxIterations` was `undefined` for every one of the three authoring paths.
 */
import 'reflect-metadata'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CompiledAgentOptions } from '../../src/bridge/agent-compiler.js'
import type { ApprovalPosture } from '../../src/bridge/approval-posture.js'

const h = vi.hoisted(() => ({
  /** The `SendOptions` the SDK's `send()` was called with (the assertion target). */
  send: undefined as Record<string, unknown> | undefined,
  /** The options `Agent.getOrCreate` was called with — proves the ceiling is NOT smuggled here. */
  create: undefined as Record<string, unknown> | undefined,
}))

vi.mock('@theokit/sdk', () => ({
  Tool: { create: (spec: unknown) => spec },
  Agent: {
    getOrCreate: vi.fn(async (_id: string, opts: Record<string, unknown>) => {
      h.create = opts
      return {
        agentId: _id,
        send: async (_msg: unknown, sendOpts?: Record<string, unknown>) => {
          h.send = sendOpts
          return {
            events: async function* () {
              yield { kind: 'message', message: { type: 'status', status: 'FINISHED' } }
            },
            wait: async () => ({}),
          }
        },
        dispose: async () => {},
      }
    }),
  },
}))

const { createSdkAgentStream, toAgentFactory } = await import('../../src/bridge/sdk-adapter.js')
const { streamAgentUIMessages } = await import('../../src/bridge/agent-endpoint.js')
const { AgentBuilder } = await import('../../src/bridge/agent-builder.js')
const { defineAgent, compileAgentDefinition } = await import('../../src/bridge/define-agent.js')
const { applyCapabilities } = await import('../../src/capability/capability.js')
const { ModelCapability } = await import('../../src/capability/capabilities.js')
const { AgentConfigCapability, MainLoopCapability } =
  await import('../../src/capability/agent-capabilities.js')

/** Drain a stream to completion — the assertion is on what the mock captured, not on the events. */
async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of stream) {
    // consume
  }
}

/** Run a compiled agent through the real adapter and return the captured `SendOptions`. */
async function sendOptionsFor(
  compiled: CompiledAgentOptions,
): Promise<Record<string, unknown> | undefined> {
  const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key')
  await drain(factory('go', `sess-${Math.random()}`))
  return h.send
}

/** The posture every served-handle case here uses — HITL is not what these tests are about. */
const NO_GATE: ApprovalPosture = {
  kind: 'auto-reject',
  reason: 'theokit#363 step-ceiling tests exercise send options, never tool approval',
}

describe('theokit#363 declared step ceiling reaches the SDK send', () => {
  beforeEach(() => {
    h.send = undefined
    h.create = undefined
  })

  it('test_decorator_maxIterations_reaches_sdk_send_options', async () => {
    // The `@Agent({ maxIterations })` surface — the one path that already DECLARED a ceiling and
    // whose declaration the served path dropped on the floor.
    const compiled = applyCapabilities([
      new ModelCapability('m'),
      new AgentConfigCapability({ maxIterations: 3 }),
    ])

    expect(await sendOptionsFor(compiled)).toMatchObject({ maxIterations: 3 })
  })

  it('test_mainloop_maxIterations_reaches_sdk_send_options', async () => {
    // `@MainLoop` outranks `@Agent` for this field; the winner is what must travel.
    const compiled = applyCapabilities([
      new ModelCapability('m'),
      new AgentConfigCapability({ maxIterations: 3 }),
      new MainLoopCapability({ maxIterations: 7 }),
    ])

    expect(await sendOptionsFor(compiled)).toMatchObject({ maxIterations: 7 })
  })

  it('test_defineAgent_maxIterations_reaches_sdk_send_options', async () => {
    const compiled = compileAgentDefinition(defineAgent({ model: 'm', maxIterations: 4 }))

    expect(await sendOptionsFor(compiled)).toMatchObject({ maxIterations: 4 })
  })

  it('test_builder_maxIterations_reaches_sdk_send_options', async () => {
    // The chain the scaffold writes — the path that decides the multi-step benchmark.
    const def = AgentBuilder.create().model('m').maxIterations(5).build()
    const compiled = compileAgentDefinition(def)

    expect(await sendOptionsFor(compiled)).toMatchObject({ maxIterations: 5 })
  })

  it('test_all_three_authoring_paths_agree_on_the_same_ceiling', async () => {
    // A path that compiles but does not limit is the defect, not the missing method. Same declared
    // number, same value crossing the boundary, whichever surface the author chose.
    const decorator = applyCapabilities([
      new ModelCapability('m'),
      new AgentConfigCapability({ maxIterations: 6 }),
    ])
    const functional = compileAgentDefinition(defineAgent({ model: 'm', maxIterations: 6 }))
    const fluent = compileAgentDefinition(AgentBuilder.create().model('m').maxIterations(6).build())

    const observed = [
      (await sendOptionsFor(decorator))?.maxIterations,
      (await sendOptionsFor(functional))?.maxIterations,
      (await sendOptionsFor(fluent))?.maxIterations,
    ]

    expect(observed).toEqual([6, 6, 6])
  })

  it('test_streamAgentUIMessages_carries_the_ceiling', async () => {
    // The served entry point itself (what `mountAgent` calls), not just the adapter beneath it.
    const compiled = compileAgentDefinition(
      AgentBuilder.create().model('m').maxIterations(2).build(),
    )

    await drain(
      streamAgentUIMessages(compiled, 'test-key', {
        message: 'go',
        sessionId: 'sess-ui',
      }),
    )

    expect(h.send).toMatchObject({ maxIterations: 2 })
  })

  it('test_served_agent_handle_defaults_the_ceiling_on_its_sends', async () => {
    // `toAgentFactory` hands the agent to someone else (ACP), so the ceiling has to ride the handle.
    const def = AgentBuilder.create().model('m').maxIterations(3).build()
    const handle = await toAgentFactory(def, { apiKey: 'test-key', approvals: NO_GATE })('sess-acp')

    await handle.send('go')

    expect(h.send).toMatchObject({ maxIterations: 3 })
  })

  it('test_caller_supplied_ceiling_wins_over_the_declared_one', async () => {
    // Per-run override precedence, same as `model` / `reasoningEffort`.
    const def = AgentBuilder.create().model('m').maxIterations(3).build()
    const handle = await toAgentFactory(def, { apiKey: 'test-key', approvals: NO_GATE })('sess-ovr')

    await handle.send('go', { maxIterations: 9 })

    expect(h.send).toMatchObject({ maxIterations: 9 })
  })
})

describe('theokit#363 an agent that declares no ceiling is untouched', () => {
  beforeEach(() => {
    h.send = undefined
    h.create = undefined
  })

  it('test_no_declaration_omits_the_key_entirely', async () => {
    // NO NEW DEFAULT. The key is absent — not `undefined`, absent — so the SDK's own ceiling (8)
    // still applies and no existing agent's behavior moves because this shipped.
    const compiled = compileAgentDefinition(defineAgent({ model: 'm' }))

    const sendOptions = await sendOptionsFor(compiled)

    expect(sendOptions).toBeDefined()
    expect(sendOptions && 'maxIterations' in sendOptions).toBe(false)
  })

  it('test_no_declaration_leaves_the_served_handle_unwrapped', async () => {
    const def = AgentBuilder.create().model('m').build()
    const handle = await toAgentFactory(def, { apiKey: 'test-key', approvals: NO_GATE })(
      'sess-bare',
    )

    await handle.send('go')

    expect(h.send && 'maxIterations' in h.send).toBeFalsy()
  })

  it('test_ceiling_is_not_smuggled_into_agent_create_options', async () => {
    // It is a PER-SEND ceiling. Putting it on `Agent.getOrCreate` would bind it to a CACHED agent
    // (options are ignored on a cache hit), making the cap accumulate across a session's turns.
    const compiled = compileAgentDefinition(defineAgent({ model: 'm', maxIterations: 4 }))

    await sendOptionsFor(compiled)

    expect(h.create && 'maxIterations' in h.create).toBe(false)
    expect(h.create && 'budgetTracker' in h.create).toBe(false)
  })
})

describe('theokit#363 an invalid ceiling fails at the authoring boundary', () => {
  it('test_zero_is_rejected', () => {
    expect(() => defineAgent({ model: 'm', maxIterations: 0 })).toThrow(/positive integer/)
  })

  it('test_negative_is_rejected', () => {
    expect(() => AgentBuilder.create().model('m').maxIterations(-3).build()).toThrow(
      /positive integer/,
    )
  })

  it('test_fractional_is_rejected_before_the_sdk_sees_it', () => {
    // The SDK rejects the same value, but only at `send()` and with a message naming
    // `SendOptions.maxIterations` — a surface the author never wrote.
    expect(() => AgentBuilder.create().model('m').maxIterations(2.5).build()).toThrow(
      /positive integer/,
    )
  })
})
