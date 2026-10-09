/**
 * usetheokit/theokit#969: a run's `done` event carries the cost the SDK priced.
 *
 * The adapter read `result.cost?.amount ?? 0`, but the SDK's `RunResult.cost` is a `CostBreakdown`
 * whose USD field is `amountUsd`. Every real run therefore reported cost 0, an unpriced run read as
 * a free one, and a USD ceiling could never trip.
 *
 * These tests mock ONLY `@theokit/sdk` and drive the real `createSdkAgentStream`, the shape of
 * `tests/integration/stop-reason.test.ts`. The fixtures are typed with the SDK's own
 * `CostBreakdown`, so they cannot drift from the published contract the way the old hand-written
 * `{ amount }` did.
 *
 * Absence is asserted with `Object.hasOwn`, not `done.cost === undefined`: a key holding
 * `undefined` would satisfy the second and still reach the wire.
 */
import 'reflect-metadata'

import type { CostBreakdown } from '@theokit/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** What the mocked SDK `Run.wait()` resolves to; each test sets the `cost` it is about. */
  waitResult: {} as Record<string, unknown>,
}))

vi.mock('@theokit/sdk', () => ({
  Tool: { create: (spec: unknown) => spec },
  Agent: {
    getOrCreate: vi.fn(async (id: string) => ({
      agentId: id,
      send: async () => ({
        events: async function* () {
          yield { kind: 'message', message: { type: 'status', status: 'FINISHED' } }
        },
        wait: async () => h.waitResult,
      }),
      dispose: async () => {},
    })),
  },
}))

const { createSdkAgentStream } = await import('../../src/bridge/sdk-adapter.js')
const { streamAgentUIMessages } = await import('../../src/bridge/agent-endpoint.js')
const { defineAgent, compileAgentDefinition } = await import('../../src/bridge/define-agent.js')

/** A fixed per-call session id, so a run is reproducible. */
let session = 0

/** The terminal `done` event `createSdkAgentStream` ends on. */
async function terminalDone(): Promise<Record<string, unknown>> {
  const stream = createSdkAgentStream(
    compileAgentDefinition(defineAgent({ model: 'm' })),
    [],
    'test-key',
  )('go', `sess-${++session}`)
  let last: Record<string, unknown> | undefined
  for await (const event of stream) last = event as Record<string, unknown>
  if (last?.type !== 'done') throw new Error(`expected a terminal done, got ${String(last?.type)}`)
  return last
}

/** The `messageMetadata` on the served `finish` chunk, what `mountAgent` sends a client. */
async function finishMetadata(): Promise<Record<string, unknown>> {
  let last: Record<string, unknown> | undefined
  for await (const chunk of streamAgentUIMessages(
    compileAgentDefinition(defineAgent({ model: 'm' })),
    'test-key',
    { message: 'go', sessionId: `sess-${++session}` },
  )) {
    last = chunk as unknown as Record<string, unknown>
  }
  if (last?.type !== 'finish') throw new Error(`expected a finish chunk, got ${String(last?.type)}`)
  const metadata = last.messageMetadata
  if (typeof metadata !== 'object' || metadata === null) {
    throw new Error('the finish chunk carries no messageMetadata')
  }
  return metadata as Record<string, unknown>
}

describe('a run reports the cost the SDK priced', () => {
  beforeEach(() => {
    h.waitResult = {}
  })

  it('test_a_priced_run_reports_the_sdk_amount_usd', async () => {
    const cost: CostBreakdown = {
      amountUsd: 0.25,
      status: 'estimated',
      currency: 'USD',
      source: 'litellm_snapshot',
      pricingVersion: 'v1',
    }
    h.waitResult = { result: 'ok', cost }

    const done = await terminalDone()

    expect(done.cost, 'the SDK priced the run at 0.25 USD').toBe(0.25)
  })

  it('test_a_run_with_no_price_reports_no_cost', async () => {
    const cost: CostBreakdown = {
      amountUsd: undefined,
      status: 'unknown',
      currency: 'USD',
      source: 'unknown',
      pricingVersion: undefined,
    }
    h.waitResult = { result: 'ok', cost }

    const done = await terminalDone()

    expect(Object.hasOwn(done, 'cost'), 'an unpriced run must not read as a free one').toBe(false)
  })

  it('test_a_run_with_no_cost_object_reports_no_cost', async () => {
    h.waitResult = { result: 'ok' }

    const done = await terminalDone()

    expect(Object.hasOwn(done, 'cost'), 'a result with no cost object has no known price').toBe(
      false,
    )
  })

  it('test_a_run_priced_at_zero_reports_cost_zero', async () => {
    const cost: CostBreakdown = {
      amountUsd: 0,
      status: 'included',
      currency: 'USD',
      source: 'subscription_included',
      pricingVersion: undefined,
    }
    h.waitResult = { result: 'ok', cost }

    const done = await terminalDone()

    expect(Object.hasOwn(done, 'cost'), 'zero is a price, not an absence').toBe(true)
    expect(done.cost).toBe(0)
  })
})

describe('the served finish metadata carries the cost the SDK priced, and none when it has no price', () => {
  beforeEach(() => {
    h.waitResult = {}
  })

  it('test_a_priced_run_sends_the_cost_on_the_finish_metadata', async () => {
    const cost: CostBreakdown = {
      amountUsd: 0.25,
      status: 'estimated',
      currency: 'USD',
      source: 'litellm_snapshot',
      pricingVersion: 'v1',
    }
    h.waitResult = { result: 'ok', cost }

    expect((await finishMetadata()).cost).toBe(0.25)
  })

  it('test_an_unpriced_run_sends_no_cost_key_on_the_finish_metadata', async () => {
    const cost: CostBreakdown = {
      amountUsd: undefined,
      status: 'unknown',
      currency: 'USD',
      source: 'unknown',
      pricingVersion: undefined,
    }
    h.waitResult = { result: 'ok', cost }

    const metadata = await finishMetadata()

    expect(Object.hasOwn(metadata, 'cost'), 'a client must not read an unpriced run as free').toBe(
      false,
    )
  })
})
