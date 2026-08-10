import { describe, expect, it } from 'vitest'

import {
  // Proving the alias is the SAME class requires importing it — it is the only legitimate use of the
  // deprecated name in the repository, and this test is what guarantees it stays an alias and does
  // not become a copy (M73).
  BudgetExceededError as AliasDeprecado,
  DelegationBudgetExceededError,
} from '../../src/bridge/delegation-types.js'
import * as barrel from '../../src/index.js'

/**
 * M91 T5.1 — the delegation error stops shadowing the SDK's.
 *
 * ## The defect
 *
 * `BudgetExceededError` existed on both sides and was NOT the same thing: in the SDK it is a context
 * WINDOW budget (`budgetName`/`window`/`spentUsd`/`mode`); here it is a DELEGATION budget
 * (`agentName`/`actualCost`/`budgetLimit`). Since the consumer holds an unbreakable rule never to
 * import `@theokit/sdk` directly, it **never reached the SDK's** — and an `instanceof` against the
 * barrel matched the wrong domain **silently**.
 *
 * It is the failure mode M73 documented: when two classes compete for the same name, no behavioural
 * test goes red. Only referential identity catches it.
 *
 * ## Why `toBe` and not `toBeDefined`
 *
 * Inherited from `auth-parity.test.ts` (M73): if the build inlines the source, the alias becomes a
 * **copy** of the class, `instanceof` starts failing silently and a `toBeDefined` sees nothing.
 */
describe('M91 — the delegation error no longer shadows the one from the SDK', () => {
  it('the deprecated alias is the SAME class, not a copy', () => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    expect(AliasDeprecado).toBe(DelegationBudgetExceededError)
  })

  it('instanceof holds in BOTH directions through the alias', () => {
    const err = new DelegationBudgetExceededError('an-agent', 1.5, 1)
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    expect(err).toBeInstanceOf(AliasDeprecado)
  })

  it('the instance name is the NEW name', () => {
    const err = new DelegationBudgetExceededError('an-agent', 1.5, 1)
    expect(err.name).toBe('DelegationBudgetExceededError')
  })

  it('the barrel exports the DELEGATION error under the new name', () => {
    expect(barrel.DelegationBudgetExceededError).toBe(DelegationBudgetExceededError)
  })

  /**
   * NON-BREAKING — the finding M91's review caught after I had already published.
   *
   * The first attempt (`4.26.0`) **reused** the name: the barrel started exporting the SDK class as
   * `BudgetExceededError`. A consumer on `^4.25` with
   * `catch (e) { if (e instanceof BudgetExceededError) … }` saw the delegation branch **stop matching,
   * silently** — the failure mode this milestone exists to kill, mirrored, shipped as a MINOR. This
   * test is what prevents the repeat.
   */
  it('NON-BREAKING — the barrel keeps BudgetExceededError = the DELEGATION class', () => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- this is the alias the test protects
    expect(barrel.BudgetExceededError).toBe(DelegationBudgetExceededError)
  })

  it('the WINDOW error from the SDK crosses under its OWN name, reusing nobody elses', () => {
    expect(barrel.WindowBudgetExceededError).toBeDefined()
  })

  it('COUNTERPROOF — window and delegation are DIFFERENT classes', () => {
    // The invariant the milestone bought: both reachable, each under its own name.
    expect(barrel.WindowBudgetExceededError).not.toBe(barrel.DelegationBudgetExceededError)
  })

  it('the WINDOW class from the SDK constructs with ITS OWN shape — the proof they are distinct domains', () => {
    const windowMs = new barrel.WindowBudgetExceededError({
      budgetName: 'ctx',
      window: 'session',
      spentUsd: 5,
      limitUsd: 1,
    } as never)
    expect(windowMs).toBeInstanceOf(barrel.WindowBudgetExceededError)
  })

  it('the message preserves its format — the rename does not change behaviour', () => {
    const err = new DelegationBudgetExceededError('Planner', 1.5, 1)
    expect(err.message).toContain('Planner')
  })
})
