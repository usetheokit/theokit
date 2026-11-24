/**
 * A subagent's `memory:` declaration reaches the prompt it governs.
 *
 * MEASURED 2026-09-15: the SDK carries the declaration on the definition, `@theokit/agents`
 * resolves the root and reads `MEMORY.md`, and NOTHING joined the two — `applySubagentMemory` had
 * zero callers in this product. An author wrote `memory: project`, saw no complaint, and concluded
 * it took effect. That is the accepted-and-ignored failure the surfaces rule exists to prevent,
 * arriving through an absent call rather than through a refusal.
 *
 * ## Why the root travels with each agent
 *
 * `discoverRoles` reads two roots and the scopes resolve against different bases: `project` and
 * `local` are relative to the root the agent came FROM, `user` is relative to home. Applying one
 * root to both halves would hand an operator's agent the project's notes, or the reverse — and the
 * three scopes differ in exactly one way, which is who can see them.
 *
 * ## Why an unrecognised scope drops ONE agent
 *
 * `resolveAgentMemory` throws on a scope it does not define, deliberately: defaulting would publish
 * on the next commit something somebody wrote expecting privacy. But a throw inside a loop over a
 * directory takes every sibling with it — which is exactly the defect B-098 fixed one layer down,
 * where one ported file stopped every other agent from loading. The same shape, so the same answer:
 * skip the file, keep the directory, say so.
 */
import { describe, expect, it } from 'vitest'

import { applyMemoryToRoles } from '../../src/delegation/role-memory.js'

type Def = { prompt: string; memory?: string }

/**
 * A stand-in for the applier, so this tests the WIRING and not the reader it calls.
 *
 * Generic, because the real `applySubagentMemory` is: it returns the SAME shape it was handed, and
 * a non-generic stand-in would type-check here while failing to satisfy the contract at the call
 * site — a fake that is easier to satisfy than the thing it replaces proves less than it appears to.
 */
// `_agent` keeps the POSITION the real applier has — the fake has to line up argument for
// argument or it stops standing in for it, and the repo's convention marks a deliberately
// unused parameter with the underscore rather than dropping it.
const fakeApply = <T extends Def>(d: T, _agent: string, cwd: string, home?: string): T => {
  if (d.memory === 'bogus') throw new Error(`memory scope "bogus" is not one of: project, local, user`)
  if (d.memory === undefined) return d
  const root = d.memory === 'user' ? (home ?? '<no-home>') : cwd
  return { ...d, prompt: `${d.prompt}\n\n## Your memory\n\nnote from ${root}` }
}

const roles = (): Record<string, Def> => ({
  keeper: { prompt: 'You keep things.', memory: 'project' },
  crosser: { prompt: 'You cross projects.', memory: 'user' },
  plain: { prompt: 'You declare nothing.' },
})

describe('the memory declaration reaches the prompt', () => {
  it('test_a_project_scope_resolves_against_the_root_the_agent_came_from', () => {
    const out = applyMemoryToRoles(roles(), '/proj', '/home/me', fakeApply)
    expect(out.keeper?.prompt).toContain('note from /proj')
  })

  it('test_a_user_scope_resolves_against_home_not_the_agents_root', () => {
    // The scope that crosses projects must not be handed the project's notes.
    const out = applyMemoryToRoles(roles(), '/proj', '/home/me', fakeApply)
    expect(out.crosser?.prompt).toContain('note from /home/me')
  })

  it('test_an_agent_that_declares_nothing_is_returned_untouched', () => {
    const before = roles()
    const out = applyMemoryToRoles(before, '/proj', '/home/me', fakeApply)
    expect(out.plain).toEqual(before.plain)
  })

  it('test_an_unrecognised_scope_drops_that_agent_and_keeps_the_rest', () => {
    // B-098's shape, one layer up: a throw in the loop must not take the siblings with it.
    const input = { ...roles(), broken: { prompt: 'x', memory: 'bogus' } }
    const out = applyMemoryToRoles(input, '/proj', '/home/me', fakeApply)
    expect(Object.keys(out).sort()).toEqual(['crosser', 'keeper', 'plain'])
  })

  it('test_the_input_record_is_not_mutated', () => {
    // A caller mapping over a loaded record must not find it changed underneath.
    const before = roles()
    const snapshot = JSON.parse(JSON.stringify(before)) as unknown
    applyMemoryToRoles(before, '/proj', '/home/me', fakeApply)
    expect(before).toEqual(snapshot)
  })
})
