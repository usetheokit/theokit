import { describe, expect, it } from 'vitest'

import type { CompiledAgentOptions } from '../../src/bridge/agent-compiler.js'
import { assembleM8CreateOptions } from '../../src/bridge/sdk-adapter-create-options.js'

/**
 * theokit-file-based-config T2.1 — `settingSources` projects into `Agent.create({ local })`
 * DECOUPLED from inline skills (EC-3 empty = unset, EC-5 explicit wins, back-compat preserved).
 */
const base: CompiledAgentOptions = { model: 'm', tools: [], agents: {}, stream: true }

describe('T2.1 — assembleM8CreateOptions projects settingSources into local', () => {
  it('test_setting_sources_flows_to_agent_create_with_cwd — settingSources, no inline skills', () => {
    const { options } = assembleM8CreateOptions({ ...base, settingSources: ['project'] })
    expect(options.local).toEqual({ settingSources: ['project'] })
  })

  it('test_skills_only_still_gets_project_settingSources — back-compat', () => {
    const { options } = assembleM8CreateOptions({ ...base, skills: { enabled: ['x'] } })
    expect(options.local).toEqual({ settingSources: ['project'] })
  })

  it('test_no_settingSources_no_skills_leaves_local_absent', () => {
    const { options } = assembleM8CreateOptions(base)
    expect(options.local).toBeUndefined()
  })

  it('test_empty_settingSources_is_treated_as_unset (EC-3)', () => {
    const { options } = assembleM8CreateOptions({ ...base, settingSources: [] })
    expect(options.local).toBeUndefined()
  })

  it('test_settingSources_wins_over_skills_default_no_double_inject (EC-5)', () => {
    const { options } = assembleM8CreateOptions({
      ...base,
      skills: { enabled: ['x'] },
      settingSources: ['project', 'user'],
    })
    expect(options.local).toEqual({ settingSources: ['project', 'user'] })
  })
})
