/**
 * B-059 bullets 1 and 3 — an agent's shape is a list, and a fourth agent needs no fourth routine.
 *
 * `composition.test.ts` asserts what the three EXISTING agents compile to and is the equivalence
 * oracle for this change: if declaring the reviewer through `declareAgent` altered what it holds,
 * that file turns red. This file asserts the property that makes the declaration worth having —
 * that a NEW agent can be expressed without writing a new construction routine.
 */
import { describe, expect, it } from 'vitest'

import { ToolRegistry, resolveToolScope } from '../../src/tools/index.js'
import {
  REVIEWER_TOOLS,
  declareAgent,
  reviewerShape,
  toolsNamed,
  type SpecContext,
} from '../../src/composition/agent-spec.js'

function ctx(): SpecContext {
  return {
    registry: new ToolRegistry(resolveToolScope({ sandbox_mode: 'read-only' }, '/p')),
    model: 'gpt-5.4',
    reasoning_effort: 'medium',
  }
}

const names = (s: { tools: readonly { name: string }[] }): string[] =>
  s.tools.map((t) => t.name).sort()

describe('B-059 — an agent shape is declared, not written', () => {
  it('test_the_reviewer_shape_holds_exactly_the_tools_its_job_needs', async () => {
    // Same expectation `composition.test.ts` makes of the built reviewer. Stated here against the
    // DECLARATION, so the two would disagree if the declaration and the construction drifted apart.
    expect(names(reviewerShape(ctx()))).toEqual(['git_diff', 'grep', 'read_file', 'run_shell'])
  })

  it('test_a_fourth_agent_is_a_list_and_not_a_new_construction_routine', async () => {
    // The bullet, executed. A read-only auditor: strictly smaller than the coding agent, declared
    // in three lines, with no file beside chat.ts and no second Agent.create call site.
    const auditor = declareAgent('auditor', ctx(), [
      toolsNamed(ctx().registry, ['read_file', 'grep', 'list_dir']),
    ])

    expect(names(auditor)).toEqual(['grep', 'list_dir', 'read_file'])
  })

  it('test_the_fourth_agent_is_strictly_smaller_than_the_reviewer', async () => {
    // "Strictly smaller" is the property the old chain could not express at all: `buildChatAgent`'s
    // overrides can add a tool and cannot remove one (`chat.ts:320`), which is why an agent needing
    // LESS became a new routine both times it was needed.
    const auditor = declareAgent('auditor', ctx(), [
      toolsNamed(ctx().registry, ['read_file', 'grep', 'list_dir']),
    ])
    const reviewer = reviewerShape(ctx())

    const auditorTools = new Set(names(auditor))
    expect(auditorTools.has('run_shell'), 'a read-only auditor was handed a shell').toBe(false)
    expect(auditorTools.has('git_diff')).toBe(false)
    expect(names(reviewer)).toContain('run_shell')
  })

  it('test_a_shape_records_which_capability_contributed_what', async () => {
    // Provenance is why this composes through the framework layer rather than a local array: the
    // wiring is inspectable as data, so "where did this tool come from" has an answer.
    const shape = reviewerShape(ctx())

    expect(shape.provenance.map((p) => p.capability)).toContain('tools')
    expect(shape.provenance.map((p) => p.capability)).toContain('model')
  })

  it('test_an_unknown_tool_name_fails_loud_at_declaration', async () => {
    // The registry's fail-loud policy has to survive the indirection. A shape that silently dropped
    // an unknown name would hand an agent less authority than its declaration says, with no signal
    // — the "unobservable change of authority" the framework's own Toolset docstring warns about.
    // The message must NAME the offending tool, and that is the assertion rather than a bare
    // `.toThrow()`: any throw satisfies the bare form, including a crash for an unrelated reason,
    // so it would go on passing after the fail-loud policy had decayed into a stack trace. Measured
    // — the message is `unknown tool "gerp"` — not guessed from the source.
    expect(() =>
      declareAgent('typo', ctx(), [toolsNamed(ctx().registry, ['read_file', 'gerp'])]),
    ).toThrow(/unknown tool "gerp"/)
  })

  it('test_the_reviewer_tool_names_all_exist_in_the_registry', async () => {
    const { REGISTRY_TOOL_NAMES } = await import('../../src/tools/registry.js')

    for (const n of REVIEWER_TOOLS) {
      expect(
        (REGISTRY_TOOL_NAMES as readonly string[]).includes(n),
        `the reviewer declares "${n}", which the registry does not build`,
      ).toBe(true)
    }
  })
})
