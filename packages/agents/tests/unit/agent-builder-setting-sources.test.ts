import { describe, expect, it } from 'vitest'

import { AgentBuilder } from '../../src/bridge/agent-builder.js'
import { compileAgentDefinition } from '../../src/bridge/define-agent.js'
import type { SettingSourceCapability } from '../../src/bridge/setting-sources-gate.js'
import { resolveTrustPosture } from '../../src/index.js'
import type { TrustPosture } from '../../src/index.js'

/**
 * theokit-file-based-config T1.1/T1.2 — the `.settingSources({...})` builder value flows through
 * `AgentBuilder.create()…build()` (an AgentDefinition IS the config) and compiles into
 * `CompiledAgentOptions`.
 *
 * ## What M68 changed here
 *
 * The builder took `readonly SettingSource[]` and the definition carried it verbatim. It now takes
 * a selection carrying evidence, and **compile** is where that becomes SDK roots — so the
 * definition holds the declaration and the compiled options hold the decision. The two assertions
 * below say exactly that, which is why one inspects the selection and the other the resolved array.
 */
/**
 * A posture that grants `projectSettings`, built through the SDK's real path.
 *
 * M68 — `.settingSources()` takes a selection with evidence, not a string array: `project` reads
 * `<cwd>/.theokit/`, including shell-executing `hooks.json`. These tests exercise the `project`
 * source, so they have to state the trust decision the same way a caller would.
 */
function trusted(): TrustPosture<SettingSourceCapability> {
  return resolveTrustPosture<SettingSourceCapability>({
    capabilities: ['projectSettings'],
    isTrusted: () => true,
  })
}
const PROJECT_GRANTED = { project: { trustedBy: trusted() } }

describe('T1.1 — AgentBuilder.create().settingSources()', () => {
  it('test_builder_settingSources_carries_the_SELECTION_to_config', () => {
    // The definition carries the declaration, grant included — it is not resolved yet. Resolving on
    // the builder would put the gate in three places (builder, defineAgent, capability); compile is
    // the one point all three converge on.
    const def = AgentBuilder.create().model('m').settingSources(PROJECT_GRANTED).build()
    expect((def as { settingSources?: unknown }).settingSources).toEqual(PROJECT_GRANTED)
  })

  it('unset ⇒ no settingSources on the built definition', () => {
    const def = AgentBuilder.create().model('m').build()
    expect((def as { settingSources?: readonly string[] }).settingSources).toBeUndefined()
  })
})

describe('T1.2 — compile carries settingSources', () => {
  it('test_compile_RESOLVES_the_selection_into_sdk_roots', () => {
    // Order is the gate's, not the author's: `user` then `project`, always. It used to mirror
    // whatever array the caller wrote, which made the compiled value carry an authoring accident as
    // if it were meaningful.
    const compiled = compileAgentDefinition(
      AgentBuilder.create()
        .model('m')
        .settingSources({ user: true, ...PROJECT_GRANTED })
        .build(),
    )
    expect(compiled.settingSources).toEqual(['user', 'project'])
  })

  it('unset ⇒ compiled.settingSources absent', () => {
    const compiled = compileAgentDefinition(AgentBuilder.create().model('m').build())
    expect(compiled.settingSources).toBeUndefined()
  })
})
