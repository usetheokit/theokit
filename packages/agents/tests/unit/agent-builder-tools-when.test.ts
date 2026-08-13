import { describe, expect, it } from 'vitest'

import { AgentBuilder, ContextualTool } from '../../src/bridge/agent-builder.js'
import { compileAgentDefinition } from '../../src/bridge/define-agent.js'

/**
 * M69 — the runtime half of `.tools([...])` and `.when(cond, fn)`.
 *
 * The type-state guarantees live in `tests/type/agent-builder-tools-when.test-d.ts`; these assert
 * that the values actually arrive, which a type test cannot see. Both halves are needed: a chain
 * that types perfectly and drops a tool is exactly the kind of green-for-the-wrong-reason this
 * codebase keeps finding.
 */

const tool = (name: string) =>
  ContextualTool.of({ name, description: name, inputSchema: {}, handler: () => 'ok' })

const namesOf = (def: ReturnType<typeof compileAgentDefinition>) =>
  def.tools.map((t) => (t as { name: string }).name)

describe('AgentBuilder.tools — many at once', () => {
  it('test_tools_appends_every_member_in_order', () => {
    const compiled = compileAgentDefinition(
      AgentBuilder.create()
        .model('m')
        .tools([tool('a'), tool('b')])
        .build(),
    )
    expect(namesOf(compiled)).toEqual(['a', 'b'])
  })

  it('test_tools_APPENDS_rather_than_replacing_what_came_before', () => {
    // The trap a naive implementation falls into (`tools: list`), and the one that would make the
    // documented `reduce` workaround still necessary.
    const compiled = compileAgentDefinition(
      AgentBuilder.create()
        .model('m')
        .tool(tool('first'))
        .tools([tool('a'), tool('b')])
        .build(),
    )
    expect(namesOf(compiled)).toEqual(['first', 'a', 'b'])
  })

  it('test_a_computed_list_produces_the_same_result_as_the_manual_fold', () => {
    // The whole point of the milestone, asserted as an equivalence: the reduce the consumer had to
    // write outside the chain and the call inside it must agree. If they ever diverge, the workaround
    // is still the correct answer and this API is decoration.
    const list = [tool('x'), tool('y'), tool('z')]
    const viaChain = compileAgentDefinition(AgentBuilder.create().model('m').tools(list).build())

    // The fold needs its accumulator spelled out — TypeScript infers the ELEMENT type otherwise and
    // the chain stops type-checking. That annotation is itself part of the finding: the workaround
    // was not merely verbose, it had to be helped past the inference it was destroying.
    const seed: ReturnType<typeof AgentBuilder.create> = AgentBuilder.create()
    const viaFold = compileAgentDefinition(
      list
        .reduce<typeof seed>((acc, t) => acc.tool(t) as typeof seed, seed)
        .model('m')
        .build(),
    )
    expect(namesOf(viaChain)).toEqual(namesOf(viaFold))
  })

  it('test_an_empty_list_changes_nothing', () => {
    const compiled = compileAgentDefinition(
      AgentBuilder.create().model('m').tool(tool('only')).tools([]).build(),
    )
    expect(namesOf(compiled)).toEqual(['only'])
  })
})

describe('AgentBuilder.when — a conditional link mid-chain', () => {
  it('test_when_true_applies_the_branch', () => {
    const compiled = compileAgentDefinition(
      AgentBuilder.create()
        .model('m')
        .tool(tool('base'))
        .when(true, (chain) => chain.tool(tool('extra')))
        .build(),
    )
    expect(namesOf(compiled)).toEqual(['base', 'extra'])
  })

  it('test_when_false_is_a_no_op_and_keeps_everything_before_it', () => {
    // Not merely "does not add": it must not RESET. Returning a fresh builder on the false branch
    // would drop the accumulated config and pass a test that only checked the absence of `extra`.
    const compiled = compileAgentDefinition(
      AgentBuilder.create()
        .model('m')
        .system('kept')
        .tool(tool('base'))
        .when(false, (chain) => chain.tool(tool('extra')))
        .build(),
    )
    expect(namesOf(compiled)).toEqual(['base'])
    expect(compiled.systemPrompt).toBe('kept')
    expect(compiled.model).toBe('m')
  })

  it('test_the_chain_continues_after_when_on_both_branches', () => {
    // `.use(preset)` composes a whole sub-chain but cannot skip a link in the MIDDLE. This asserts
    // the middle position works — the gap that motivated the method.
    for (const condition of [true, false]) {
      const compiled = compileAgentDefinition(
        AgentBuilder.create()
          .model('m')
          .when(condition, (chain) => chain.system('conditional'))
          .tool(tool('after'))
          .build(),
      )
      expect(namesOf(compiled), `condition=${condition}`).toEqual(['after'])
    }
  })

  it('test_when_does_not_invoke_the_branch_at_all_when_false', () => {
    // A branch that runs and has its result discarded would still execute side effects the caller
    // conditioned away — and the caller conditioned it away for a reason.
    let invoked = 0
    compileAgentDefinition(
      AgentBuilder.create()
        .model('m')
        .when(false, (chain) => {
          invoked += 1
          return chain
        })
        .build(),
    )
    expect(invoked).toBe(0)
  })
})
