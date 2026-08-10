import { describe, expect, it, vi } from 'vitest'

import { AgentBuilder } from '../../src/index.js'
import { project, resolveProjection } from '../../src/bridge/definition-or-thunk.js'

/**
 * M91 T1.1 — `toAgentFactory` accepts a definition THUNK.
 *
 * ## What was wrong
 *
 * The `apiKey` parameter had accepted a thunk since M74, added for **exactly** this reason. `def` did
 * not, and the asymmetry was one line wide — but it cost: with the object shape, trust, hooks, skills
 * and MCP are compiled at module load and stay **frozen for the whole process**.
 *
 * In a `theokit acp` an IDE keeps open for hours, that reintroduces the staleness M67 removed by
 * moving the definition's construction to the entry point. M67 closed half of it; this is the other.
 *
 * ## Why the tests measure the PROJECTION COUNT and not the handle
 *
 * Building the handle requires the SDK runtime and a credential. The invariant that matters comes
 * before that: **how many times the definition is projected**. Once for N sessions (the object shape,
 * behaviour preserved) versus once per session (the thunk shape, what it buys). `resolveProjection`
 * is the seam that decides it, and it is where the test bites.
 */
describe('M91 — resolveProjection decides between the object shape and the thunk', () => {
  const agentDef = (): ReturnType<typeof AgentBuilder.create>['build'] extends () => infer D
    ? D
    : never => AgentBuilder.create().model('openai/gpt-4o-mini').system('oi').build() as never

  it('the OBJECT shape projects ONCE, regardless of how many sessions', async () => {
    const def = agentDef()
    const spy = vi.fn(() => def)
    // `resolveProjection` receives the object directly; the spy counts calls to the thunk, which does
    // not exist here.
    const projectPerSession = resolveProjection(def as never, {})
    const a = await projectPerSession('s1')
    const b = await projectPerSession('s2')
    expect(spy).not.toHaveBeenCalled()
    // The same reference: the projection is reused, not recomputed.
    expect(b).toBe(a)
  })

  it('the THUNK shape projects PER SESSION — the point of the milestone', async () => {
    const def = agentDef()
    const calls: string[] = []
    const projectPerSession = resolveProjection((id: string) => {
      calls.push(id)
      return def as never
    }, {})
    await projectPerSession('s1')
    await projectPerSession('s2')
    expect(calls).toEqual(['s1', 's2'])
  })

  it('the thunk receives the real sessionId, not a placeholder', async () => {
    const def = agentDef()
    const seen: string[] = []
    const projectPerSession = resolveProjection((id: string) => {
      seen.push(id)
      return def as never
    }, {})
    await projectPerSession('session-x')
    expect(seen).toEqual(['session-x'])
  })

  it('an ASYNC thunk is awaited before projecting', async () => {
    const def = agentDef()
    const projectPerSession = resolveProjection(async () => {
      await Promise.resolve()
      return def as never
    }, {})
    const p = await projectPerSession('s1')
    expect(p.model).toBe('openai/gpt-4o-mini')
  })

  it('COUNTERPROOF — two projections of the thunk are distinct instances', async () => {
    const def = agentDef()
    const projectPerSession = resolveProjection(() => def as never, {})
    const a = await projectPerSession('s1')
    const b = await projectPerSession('s2')
    expect(b).not.toBe(a)
  })

  it('overrides.model beats the model of the definition, in both shapes', async () => {
    const def = agentDef()
    const eager = await resolveProjection(def as never, { model: 'anthropic/claude' })('s1')
    const lazy = await resolveProjection(() => def as never, { model: 'anthropic/claude' })('s1')
    expect(eager.model).toBe('anthropic/claude')
    expect(lazy.model).toBe('anthropic/claude')
  })

  it('projecting applies the default when neither definition nor override has a model', () => {
    // Built as DATA, not by the builder: `build()` refuses at compile time when a model is missing
    // (the parameter becomes `MissingModelError`), so the state is unreachable through the fluent API.
    // `project`'s default exists for definitions arriving another way — `defineAgent`, an agent module
    // on disk — and `AgentDefinition` has been pure data since M79, so this is legitimate.
    const withoutModel = { name: 'no-model', system: 'hi', tools: [] }
    const p = project(withoutModel as never, {})
    expect(p.model).toBe('openai/gpt-4o-mini')
  })
})
