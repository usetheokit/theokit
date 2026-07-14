import { describe, expect, it } from 'vitest'

import { agent } from '../../src/bridge/agent-builder.js'
import { compileAgentDefinition } from '../../src/bridge/define-agent.js'

/**
 * theokit-file-based-config T1.1/T1.2 — the `.settingSources([...])` builder value flows through
 * `agent()…build()` (an AgentDefinition IS the config) and compiles into `CompiledAgentOptions`.
 */
describe('T1.1 — agent().settingSources()', () => {
  it('test_builder_settingSources_carries_to_config', () => {
    const def = agent().model('m').settingSources(['project']).build()
    expect((def as { settingSources?: readonly string[] }).settingSources).toEqual(['project'])
  })

  it('unset ⇒ no settingSources on the built definition', () => {
    const def = agent().model('m').build()
    expect((def as { settingSources?: readonly string[] }).settingSources).toBeUndefined()
  })
})

describe('T1.2 — compile carries settingSources', () => {
  it('test_compile_carries_settingSources', () => {
    const compiled = compileAgentDefinition(
      agent().model('m').settingSources(['project', 'user']).build(),
    )
    expect(compiled.settingSources).toEqual(['project', 'user'])
  })

  it('unset ⇒ compiled.settingSources absent', () => {
    const compiled = compileAgentDefinition(agent().model('m').build())
    expect(compiled.settingSources).toBeUndefined()
  })
})
