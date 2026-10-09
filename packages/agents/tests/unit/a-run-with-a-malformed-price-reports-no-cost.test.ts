/**
 * usetheokit/theokit#969, edge cases EC-1 and EC-2: a price that is not a finite number is not a
 * price.
 *
 * The reflective loop folds `done.cost` with `asNumber`, which accepts `NaN`, and compares the
 * running total with `acc.cost > budget`. A `NaN` total makes that comparison false forever, so a
 * USD ceiling would never trip. The adapter is where a non-finite `amountUsd`, or a `cost` that is
 * `null`, has to become "price not known": an absent `cost` key, never `NaN` and never 0.
 *
 * Kept apart from `a-run-reports-the-cost-the-sdk-priced.test.ts` so that file's four tests stay
 * the four the alignment brief's AC-001 to AC-003 name.
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
const { defineAgent, compileAgentDefinition } = await import('../../src/bridge/define-agent.js')

/** A fixed per-call session id, so a run is reproducible. */
let session = 0

/** The last event `createSdkAgentStream` yields; a throw would surface as an `error` event. */
async function lastEvent(): Promise<Record<string, unknown>> {
  const stream = createSdkAgentStream(
    compileAgentDefinition(defineAgent({ model: 'm' })),
    [],
    'test-key',
  )('go', `sess-${++session}`)
  let last: Record<string, unknown> | undefined
  for await (const event of stream) last = event as Record<string, unknown>
  if (last === undefined) throw new Error('the stream yielded no event')
  return last
}

describe('a run with a malformed price reports no cost', () => {
  beforeEach(() => {
    h.waitResult = {}
  })

  it.each([
    ['nan', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
  ])('test_a_run_priced_at_%s_reports_no_cost', async (_label, amountUsd) => {
    const cost: CostBreakdown = {
      amountUsd,
      status: 'estimated',
      currency: 'USD',
      source: 'litellm_snapshot',
      pricingVersion: 'v1',
    }
    h.waitResult = { result: 'ok', cost }

    const done = await lastEvent()

    expect(done.type).toBe('done')
    expect(Object.hasOwn(done, 'cost'), `amountUsd ${String(amountUsd)} is not a price`).toBe(false)
  })

  it('test_a_run_with_a_null_cost_reports_no_cost', async () => {
    // An untyped caller, or an SDK double, can resolve `cost: null`; the result type does not
    // admit it, which is why the fixture is a plain record here.
    h.waitResult = { result: 'ok', cost: null }

    const done = await lastEvent()

    expect(done.type, 'a null cost must not turn the run into an error').toBe('done')
    expect(Object.hasOwn(done, 'cost'), 'a null cost has no known price').toBe(false)
  })
})
