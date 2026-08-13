import { describe, expect, it } from 'vitest'

import { AgentBuilder, ContextualTool } from '../../src/bridge/agent-builder.js'
import { compileAgentDefinition } from '../../src/bridge/define-agent.js'
import { ModelCapability, ToolsCapability } from '../../src/capability/capabilities.js'
import { declareAgentShape } from '../../src/capability/agent-shape.js'

/**
 * M69 — `declareAgentShape(name, members)`: what an agent is MADE OF, as a published value.
 *
 * ## The gap
 *
 * `applyCapabilities` returns a `FinalizedDraft` — `Partial<CompiledAgentOptions>` plus a MUTABLE
 * `provenance` array. It is the compiler's working surface, and it is the only thing the capability
 * layer hands back. A consumer that wants to know "which tools does this agent have, and who put
 * them there" has to depend on the entire compiled-options shape and receive an array it can push
 * into.
 *
 * The three construction sites — the `AgentBuilder`, `Agent.create`, and roles loaded from disk —
 * all need the same small answer, and none of them should be handed the draft to get it.
 *
 * ## Why these four fields and not the whole draft
 *
 * `{ tools, model, reasoningEffort, provenance }` is the shape a caller composes and reasons about:
 * what the agent can do, on which model, at what effort, and where each of those came from.
 * Everything else in the compiled options is downstream projection. Publishing the narrow value
 * keeps the wide internal one free to change — the reason it was internal to begin with.
 */

const tool = (name: string) => ({
  name,
  description: name,
  inputSchema: {},
  handler: () => 'ok',
})

describe('declareAgentShape — the composed shape as a value', () => {
  it('test_it_carries_the_four_declared_fields', () => {
    const shape = declareAgentShape('assistant', [
      new ModelCapability('anthropic/claude-sonnet-5'),
      new ToolsCapability([tool('alpha')]),
    ])
    expect(shape.name).toBe('assistant')
    expect(shape.model).toBe('anthropic/claude-sonnet-5')
    expect(shape.tools.map((t) => (t as { name: string }).name)).toEqual(['alpha'])
  })

  it('test_provenance_records_which_capability_contributed_what', () => {
    // The field that makes the shape auditable rather than merely descriptive: two capabilities can
    // both touch `tools`, and without provenance a reader cannot tell which one to go edit.
    const shape = declareAgentShape('assistant', [
      new ModelCapability('m'),
      new ToolsCapability([tool('alpha')]),
    ])
    expect(shape.provenance.map((p) => p.capability)).toContain('model')
    expect(shape.provenance.flatMap((p) => p.contributed)).toContain('model')
  })

  it('test_the_returned_shape_is_FROZEN', () => {
    // The draft is mutable by design — capabilities enrich it in place. The published value must
    // not be: handing a consumer something it can push into makes the shape a shared mutable, and
    // the next reader cannot tell whether what they hold is what was declared.
    const shape = declareAgentShape('assistant', [new ModelCapability('m')])
    expect(Object.isFrozen(shape)).toBe(true)
    expect(Object.isFrozen(shape.provenance)).toBe(true)
    expect(Object.isFrozen(shape.tools)).toBe(true)
  })

  it('test_it_agrees_with_the_builder_on_the_same_declaration', () => {
    // The equivalence that makes this consumable by the three construction sites: a shape declared
    // from capabilities and the same agent built through the chain must report the same tools and
    // model. If they can disagree, the shape is a second source of truth rather than a projection.
    const shape = declareAgentShape('assistant', [
      new ModelCapability('m'),
      new ToolsCapability([tool('alpha'), tool('beta')]),
    ])
    const compiled = compileAgentDefinition(
      AgentBuilder.create()
        .model('m')
        .tools([ContextualTool.of(tool('alpha')), ContextualTool.of(tool('beta'))])
        .build(),
    )
    expect(shape.tools.map((t) => (t as { name: string }).name)).toEqual(
      compiled.tools.map((t) => (t as { name: string }).name),
    )
    expect(shape.model).toBe(compiled.model)
  })

  it('test_an_empty_member_list_is_a_valid_shape_that_declares_nothing', () => {
    // Not an error: a role loaded from disk may legitimately declare no capability yet. What it must
    // NOT do is look like a shape with tools.
    const shape = declareAgentShape('bare', [])
    expect(shape.tools).toEqual([])
    expect(shape.model).toBeUndefined()
    expect(shape.provenance).toEqual([])
  })

  it('test_a_conflicting_redeclaration_still_fails_fast', () => {
    // The shape is a projection of `applyCapabilities`, so it must inherit its set-once discipline.
    // A narrower return type that silently swallowed the conflict would be a downgrade disguised as
    // ergonomics.
    expect(() =>
      declareAgentShape('assistant', [new ModelCapability('a'), new ModelCapability('b')]),
    ).toThrow()
  })
})
