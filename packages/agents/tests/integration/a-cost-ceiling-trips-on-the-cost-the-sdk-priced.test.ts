/**
 * B-409 through the real adapter: the USD ceiling acts on the cost the SDK priced.
 *
 * Every other B-409 test scripts `done.cost` through an injected `streamFactory`, so each one passed
 * while the real adapter built `done.cost` from `result.cost?.amount`, a field the SDK's
 * `CostBreakdown` does not have. Every real round then reported a known cost of 0 and the ceiling
 * could never trip (review F-wire-1). usetheokit/theokit#969 (B-419) made the adapter read
 * `amountUsd`; these tests pin the two together.
 *
 * Only `@theokit/sdk` is mocked. The runner gets no `streamFactory`, so each round goes through the
 * real `createSdkAgentStream`, whose terminal `done` is built from `Run.wait()`'s `CostBreakdown`.
 * Each round yields a completed tool call so the loop asks for another round, the shape of
 * `loop-session-history.test.ts`.
 */
import 'reflect-metadata'

import type { CostBreakdown } from '@theokit/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** The `cost` every round's `Run.wait()` resolves with. */
  cost: undefined as unknown,
  sends: 0,
}))

vi.mock('@theokit/sdk', () => ({
  Tool: { create: (spec: unknown) => spec },
  Agent: {
    getOrCreate: vi.fn(async (id: string) => ({
      agentId: id,
      send: async () => {
        const round = h.sends++
        return {
          events: async function* () {
            yield {
              kind: 'message',
              message: {
                type: 'assistant',
                message: { content: [{ type: 'text', text: `r-${String(round)}` }] },
              },
            }
            yield {
              kind: 'message',
              message: {
                type: 'tool_call',
                status: 'completed',
                call_id: `c-${String(round)}`,
                name: `t${String(round)}`,
                result: 'r',
              },
            }
            yield { kind: 'message', message: { type: 'status', status: 'FINISHED' } }
          },
          wait: async () => ({ result: 'ok', cost: h.cost }),
        }
      },
      dispose: async () => {},
    })),
  },
}))

const { AgentRunner, DelegationBudgetCostUnknownError, DelegationBudgetExceededError } =
  await import('../../src/index.js')
const { applyCapabilities } = await import('../../src/capability/capability.js')
const { ModelCapability } = await import('../../src/capability/capabilities.js')
const { MainLoopCapability } = await import('../../src/capability/agent-capabilities.js')

function buildRunner() {
  const compiled = applyCapabilities([
    new ModelCapability('test-model'),
    new MainLoopCapability({ maxIterations: 5 }),
  ])
  return AgentRunner.fromSpec({
    compiled,
    name: 'pricedAgent',
    strategy: 'plan-act-reflect',
  }).build()
}

async function runAndCatch(maxCostUsd: number): Promise<unknown> {
  try {
    await buildRunner().run('go', { apiKey: 'k', budget: { maxCostUsd } })
  } catch (err) {
    return err
  }
  return undefined
}

describe('the USD ceiling acts on the cost the real adapter reports', () => {
  beforeEach(() => {
    h.sends = 0
    h.cost = undefined
  })

  it('test_a_priced_round_from_the_sdk_trips_the_ceiling_before_the_next_round', async () => {
    const cost: CostBreakdown = {
      amountUsd: 0.01,
      status: 'estimated',
      currency: 'USD',
      source: 'litellm_snapshot',
      pricingVersion: 'v1',
    }
    h.cost = cost

    const threw = await runAndCatch(0.015)

    // $0.01 spent plus a projected $0.01 passes $0.015, so round 2 never reaches the SDK.
    expect(h.sends).toBe(1)
    expect(threw).toBeInstanceOf(DelegationBudgetExceededError)
    expect(threw).not.toBeInstanceOf(DelegationBudgetCostUnknownError)
    const error = threw as InstanceType<typeof DelegationBudgetExceededError>
    expect(error.actualCost).toBe(0.01)
    expect(error.projectedRoundCost).toBe(0.01)
  })

  it('test_an_unpriced_round_from_the_sdk_stops_a_run_with_a_ceiling', async () => {
    const cost: CostBreakdown = {
      amountUsd: undefined,
      status: 'unknown',
      currency: 'USD',
      source: 'unknown',
      pricingVersion: undefined,
    }
    h.cost = cost

    const threw = await runAndCatch(1)

    expect(h.sends).toBe(1)
    expect(threw).toBeInstanceOf(DelegationBudgetCostUnknownError)
  })
})
