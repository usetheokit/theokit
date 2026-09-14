/**
 * B-079 + B-080 — the agent declares the work it is judged on.
 *
 * One test file for two items, because their briefs share one: *a plan the agent proposes needs
 * somewhere to live; the two may share one mechanism and must not invent two.*
 *
 * ## The half-present feature
 *
 * Measured 2026-09-14 against the resolved SDK with controls at every step: `Task.submit` is
 * published (control: an invented name returns 0 files), `task_started` appears in 10 dist files,
 * and `packages/agents/src` produces `subgoals` in **0** files and emits `task_started` in **0**.
 *
 * So the runtime models tasks, a UI can draw their lifecycle, and the agent has no way to populate
 * it. Observation without participation — which is more expensive than an absent feature, because
 * the surface looks finished.
 *
 * ## Why a declaration is a DEFERRED task
 *
 * `Task.submit<T>(kind, work, options?)` takes a work FUNCTION — it was designed to run work, and a
 * declaration has none: the work is the agent, across turns. So `work` returns a promise that stays
 * pending until `task_complete` resolves it.
 *
 * The naive reading — submit with work that returns immediately — emits `task_started` and
 * `task_completed` in the same tick. Every declaration would be born finished, and "declared and
 * open" could never be told from "never declared", which is the requirement.
 */
import { describe, expect, it, vi } from 'vitest'

import { createTaskDeclareTool, createTaskCompleteTool } from '../../src/tools/task-tools.js'

/**
 * A registry stub that behaves like the real one in the property under test: a task is FINISHED when
 * its work promise settles, and not before.
 *
 * The first version of this stub tracked completion through its own `resolvers` map and never
 * observed the work promise at all. A mutation that made the work resolve immediately — the exact
 * naive reading ADR-6 rejects — left all seven tests green, which means the suite was asserting
 * against the stub rather than against the tool. Mutation testing is what surfaced it; reading the
 * test would not have.
 */
function registryStub() {
  const submitted: Array<{ kind: string; resolved: boolean }> = []
  const resolvers = new Map<string, () => void>()
  return {
    submitted,
    resolvers,
    submit: vi.fn(
      async (kind: string, work: (ctx: { signal: AbortSignal }) => Promise<unknown>) => {
        const entry = { kind, resolved: false }
        submitted.push(entry)
        const id = `t-${submitted.length}`

        // The tool's own work promise drives completion, exactly as the real registry does. A
        // `resolvers` entry only exists so `task_complete` has something to release; if the tool
        // resolved its work for any other reason, this marks the task finished and the
        // "not born finished" assertion fails, which is the point.
        void work({ signal: new AbortController().signal }).then(() => {
          entry.resolved = true
        })
        return { id }
      },
    ),
  }
}

describe('the agent can declare a unit of work', () => {
  it('a declaration creates a task the consumer can see', async () => {
    const registry = registryStub()
    const declare = createTaskDeclareTool({ registry })
    await declare.handler({ what: 'migrate the config reader' })
    expect(registry.submit).toHaveBeenCalledTimes(1)
  })

  it('a declaration reaches the existing channel and invents no new event', async () => {
    const registry = registryStub()
    const declare = createTaskDeclareTool({ registry })
    await declare.handler({ what: 'migrate the config reader' })
    // FR-002: the EXISTING `task_*` channel. `Task.submit` is what emits `task_started`, so calling
    // it is the assertion — and `kind` must be one the SDK's own union carries.
    const [kind] = registry.submit.mock.calls[0] as [string, unknown]
    expect(['run', 'batch', 'workflow', 'cron', 'custom']).toContain(kind)
  })

  it('a declaration is not born finished', async () => {
    const registry = registryStub()
    const declare = createTaskDeclareTool({ registry })
    await declare.handler({ what: 'a unit nobody completed' })
    // The defect the deferred promise exists to prevent: work that returns immediately would emit
    // started and completed in the same tick, and FR-004 would be unsatisfiable.
    expect(registry.submitted[0]?.resolved).toBe(false)
  })

  it('completing a declaration resolves its task', async () => {
    const registry = registryStub()
    const declare = createTaskDeclareTool({ registry })
    const complete = createTaskCompleteTool({ registry })
    const raw = await declare.handler({ what: 'a unit that finishes' })
    const { id } = JSON.parse(raw) as { id: string }
    await complete.handler({ id })
    expect(registry.submitted[0]?.resolved).toBe(true)
  })

  it('a declaration never completed is reported open', async () => {
    const registry = registryStub()
    const declare = createTaskDeclareTool({ registry })
    await declare.handler({ what: 'one' })
    await declare.handler({ what: 'two' })
    const complete = createTaskCompleteTool({ registry })
    await complete.handler({ id: 't-1' })
    // Open and never-declared must be different facts: a list that only grows is a list nobody
    // trusts, and a list that silently closes is worse.
    expect(registry.submitted.map((s) => s.resolved)).toEqual([true, false])
  })

  it('completing an unknown id raises rather than silently doing nothing', async () => {
    const registry = registryStub()
    const complete = createTaskCompleteTool({ registry })
    await expect(complete.handler({ id: 'never-declared' })).rejects.toThrow(/never-declared/)
  })

  it('a rejecting registry is reported to the model rather than crashing the run', async () => {
    const registry = registryStub()
    registry.submit.mockRejectedValueOnce(new Error('registry down'))
    const declare = createTaskDeclareTool({ registry })
    const raw = await declare.handler({ what: 'something' })
    expect(JSON.parse(raw)).toMatchObject({ ok: false })
  })
})
