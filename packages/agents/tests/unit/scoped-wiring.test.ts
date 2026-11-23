import { describe, expect, it } from 'vitest'

import { recordScopedWiring } from '../../src/index.js'

const posture = (mcp: boolean) => ({ allows: { mcp, skills: true } })

describe('#2742 — recordScopedWiring', () => {
  it('test_gates_only_the_gated_group_and_keeps_each_scope', () => {
    const w = recordScopedWiring({
      posture: posture(false),
      requested: {
        mcp: {
          groups: [
            { names: ['theirs'], scope: 'project', gated: true },
            { names: ['mine'], scope: 'personal', gated: false },
          ],
        },
      },
    })
    expect(w.mcp.active).toEqual(['mine'])
    expect(w.mcp.requested).toEqual(['theirs', 'mine'])
    expect(w.mcp.suppressedByTrust).toBe(true)
    expect(w.mcp.off).toBeUndefined()
    expect(w.mcp.entities).toEqual([
      { name: 'theirs', scope: 'project' },
      { name: 'mine', scope: 'personal' },
    ])
  })

  it('test_off_is_set_only_when_nothing_is_active', () => {
    const w = recordScopedWiring({
      posture: posture(false),
      requested: { mcp: { groups: [{ names: ['theirs'], scope: 'project', gated: true }] } },
    })
    expect(w.mcp.active).toEqual([])
    expect(w.mcp.off?.reason).toBe('suppressed-by-trust')
  })

  it('test_a_name_in_two_scopes_keeps_two_rows_and_one_active_entry', () => {
    const w = recordScopedWiring({
      posture: posture(true),
      requested: {
        mcp: {
          groups: [
            { names: ['x'], scope: 'project', gated: true },
            { names: ['x'], scope: 'personal', gated: false },
          ],
        },
      },
    })
    expect(w.mcp.active).toEqual(['x'])
    expect(w.mcp.entities).toHaveLength(2)
  })

  it('test_sort_is_opt_in_and_a_missing_scope_stays_undefined', () => {
    const w = recordScopedWiring({
      posture: posture(true),
      requested: {
        mcp: { sort: true, groups: [{ names: ['b', 'a'], gated: true }] },
        skills: { groups: [{ names: ['b', 'a'], gated: true }] },
      },
    })
    expect(w.mcp.active).toEqual(['a', 'b'])
    expect(w.skills.active).toEqual(['b', 'a'])
    expect(w.skills.entities[0]?.scope).toBeUndefined()
  })
})
