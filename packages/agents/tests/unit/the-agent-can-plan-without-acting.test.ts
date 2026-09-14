/**
 * B-080 — a run in which the agent may plan and may not act.
 *
 * ## The mode already had a name, and nothing honoured it
 *
 * The SDK declares `PermissionMode = "default" | "plan" | "acceptEdits" | "bypass" |
 * "bypassPermissions"`. Measured 2026-09-14 across `packages/agents/src`: `default` appears 4 times,
 * `acceptEdits` once, `bypass` once, and **`plan` zero times**. So of the five modes the type
 * carries, the one that means "do not act" is the single one this layer never mentions — accepted by
 * the type and consulted by nobody, the shape this backlog keeps closing.
 *
 * So this does not invent a mode. It makes the declared one refuse.
 *
 * ## Refusing is not skipping
 *
 * A skipped call leaves the agent believing it succeeded, and the plan then reads as executed. That
 * is the one outcome nobody can detect afterwards, which is why the refusal is a typed error naming
 * the mode rather than a quiet no-op.
 *
 * ## Declaring must stay allowed
 *
 * A gate that refused everything in plan mode would refuse `task_declare` too, and the mode would
 * produce no plan at all — the capability defeating its own purpose.
 */
import { describe, expect, it } from 'vitest'

import { PlanOnlyRefusalError, createPlanOnlyGate } from '../../src/loop/plan-only.js'

const stateChanging = (name: string) => ({ name, args: {} })

describe('a plan-only run may decompose and may not act', () => {
  it('a state-changing call in plan mode raises a typed error naming the mode', async () => {
    const gate = createPlanOnlyGate({ isStateChanging: () => true })
    await expect(
      gate({ ...stateChanging('write_file'), permissionMode: 'plan' }),
    ).rejects.toBeInstanceOf(PlanOnlyRefusalError)
    await expect(gate({ ...stateChanging('write_file'), permissionMode: 'plan' })).rejects.toThrow(
      /plan/,
    )
  })

  it('declaring is allowed in plan mode', async () => {
    // The third failure row of the plan: refusing this would produce a mode that yields no plan.
    const gate = createPlanOnlyGate({ isStateChanging: (n) => n !== 'task_declare' })
    await expect(
      gate({ ...stateChanging('task_declare'), permissionMode: 'plan' }),
    ).resolves.toBeUndefined()
  })

  it('a non-plan mode is left entirely alone', async () => {
    const gate = createPlanOnlyGate({ isStateChanging: () => true })
    // `undefined` falls through, which is what lets this compose with another handler.
    await expect(
      gate({ ...stateChanging('write_file'), permissionMode: 'default' }),
    ).resolves.toBeUndefined()
    await expect(gate(stateChanging('write_file'))).resolves.toBeUndefined()
  })

  it('the gate composes with an existing pre_tool_call rather than replacing it', async () => {
    // `permission-gate.ts` states the hazard in its own docblock: `pre_tool_call` is a SINGLE field,
    // so assigning over an existing handler loses one silently — "and worse here because the handler
    // that loses may be the one that refuses". The documented composition is `??`, first veto wins.
    const seen: string[] = []
    const mine = async (ctx: { name: string }) => {
      seen.push(ctx.name)
      return undefined
    }
    const gate = createPlanOnlyGate({ isStateChanging: () => false })
    const composed = async (ctx: { name: string; permissionMode?: string }) =>
      (await gate(ctx)) ?? (await mine(ctx))

    await composed({ ...stateChanging('read_file'), permissionMode: 'plan' })
    expect(seen, 'the second handler never ran, so composition lost it').toEqual(['read_file'])
  })

  it('the refusal names the tool that was refused', async () => {
    const gate = createPlanOnlyGate({ isStateChanging: () => true })
    await expect(
      gate({ ...stateChanging('delete_everything'), permissionMode: 'plan' }),
    ).rejects.toThrow(/delete_everything/)
  })

  it('the mode is left only by an explicit signal, never by elapsed time', async () => {
    // AC-011. The gate holds no timer and no clock: a mode that expired on its own would let a run
    // start acting without anybody deciding it should.
    const gate = createPlanOnlyGate({ isStateChanging: () => true })
    await expect(
      gate({ ...stateChanging('write_file'), permissionMode: 'plan' }),
    ).rejects.toBeInstanceOf(PlanOnlyRefusalError)
    await new Promise((r) => setTimeout(r, 30))
    await expect(
      gate({ ...stateChanging('write_file'), permissionMode: 'plan' }),
    ).rejects.toBeInstanceOf(PlanOnlyRefusalError)
  })
})
