import { describe, expect, it } from 'vitest'

import type { CompiledAgentOptions } from '../../src/bridge/agent-compiler.js'
import { assembleM8CreateOptions } from '../../src/bridge/sdk-adapter-create-options.js'

/**
 * theokit-file-based-config T2.1 — `settingSources` projects into `Agent.create({ local })`.
 *
 * ## M68 changed what this file asserts, and the reason is worth reading
 *
 * One of these cases used to be named `test_skills_only_still_gets_project_settingSources —
 * back-compat`, and it passed. It asserted that an agent which declared inline skills — and asked
 * for nothing else — got `settingSources: ['project']`.
 *
 * `project` is the root that reads `<cwd>/.theokit/`, **including `hooks.json`, which executes
 * shell**. So the escalation was not an oversight that slipped through review: it was a documented,
 * tested, deliberate behaviour, and the test was what kept it alive. Declaring a skill is a
 * statement about prompts; it was silently buying shell execution from the working directory.
 *
 * Since M68 the projection is exactly that — a projection. The decision moved to compile time,
 * where every authoring path resolves its selection through the trust gate, so
 * `CompiledAgentOptions.settingSources` cannot hold a root no posture authorized.
 */
const base: CompiledAgentOptions = { model: 'm', tools: [], agents: {}, stream: true }

describe('T2.1 — assembleM8CreateOptions projects settingSources into local', () => {
  it('test_setting_sources_flows_to_agent_create_with_cwd — settingSources, no inline skills', () => {
    const { options } = assembleM8CreateOptions({ ...base, settingSources: ['project'] })
    expect(options.local).toEqual({ settingSources: ['project'] })
  })

  it('test_skills_alone_does_NOT_buy_the_project_source_anymore', () => {
    // The inverted assertion. This is the security fix, stated as the behaviour change it is: an
    // agent that declares skills and nothing else now reads no disk at all.
    const { options } = assembleM8CreateOptions({ ...base, skills: { enabled: ['x'] } })
    expect(
      options.local?.settingSources ?? [],
      'declaring skills re-enabled the `project` source, which reads shell-executing hooks from ' +
        'the working directory',
    ).not.toContain('project')
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
