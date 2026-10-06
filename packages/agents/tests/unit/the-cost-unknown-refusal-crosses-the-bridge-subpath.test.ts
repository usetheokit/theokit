/**
 * B-409 review F-wire-2: `DelegationBudgetCostUnknownError` crosses `@theokit/agents/bridge` with
 * its parent class.
 *
 * The `./bridge` subpath serves `delegate()`, which is where the unpriced-round refusal is
 * inherited, and it already re-exported `DelegationBudgetExceededError`. Without the subclass a
 * consumer importing from the subpath could tell the two refusals apart only by message text: the
 * same shape `bridge/index.ts` records as B-004, a refusal shipped beside the class it mirrors
 * without crossing the barrel.
 *
 * The built subpath is what a consumer resolves, so the second test imports the package by name
 * (Node's self-reference through `package.json#exports`), which reads `dist/bridge.js`. Build first:
 * `pnpm --filter @theokit/agents build`.
 */
import { describe, expect, it } from 'vitest'

import * as bridgeSource from '../../src/bridge/index.js'
import { DelegationBudgetCostUnknownError } from '../../src/index.js'

describe('the unpriced-round refusal crosses the ./bridge subpath', () => {
  it('test_the_bridge_barrel_exports_the_cost_unknown_refusal', () => {
    expect(bridgeSource.DelegationBudgetCostUnknownError).toBe(DelegationBudgetCostUnknownError)
    expect(Object.getPrototypeOf(bridgeSource.DelegationBudgetCostUnknownError.prototype)).toBe(
      bridgeSource.DelegationBudgetExceededError.prototype,
    )
  })

  it('test_the_built_bridge_subpath_exports_the_cost_unknown_refusal', async () => {
    const built = await import('@theokit/agents/bridge')

    expect(typeof built.DelegationBudgetCostUnknownError).toBe('function')
    expect(new built.DelegationBudgetCostUnknownError('a', 0, 1)).toBeInstanceOf(
      built.DelegationBudgetExceededError,
    )
  })
})
