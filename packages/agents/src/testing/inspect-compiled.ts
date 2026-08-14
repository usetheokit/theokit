import { compileAgentDefinition, type AgentDefinition } from '../bridge/define-agent.js'

/**
 * M85 — assert at the COMPILATION boundary, which is the one with the widest blast radius.
 *
 * The consumer documented this itself: in an agent product, the question that matters is not "did
 * the stream emit the right frames" but **"does this agent have the tools I think it has, and are
 * the dangerous ones gated?"**. A wrong answer there is a shell running unapproved, or a tool the
 * model cannot see and the operator believes it can.
 *
 * ## Why a helper and not `compileAgentDefinition` directly
 *
 * `CompiledAgentOptions` is the shape the SDK adapter consumes — thirty-odd fields, most of which a
 * test does not care about. Asserting against it directly is how 90 occurrences of `vi.mock` over
 * the framework barrel got written: the assertion was too awkward, so the test faked the module
 * instead, pinning itself to export NAMES and detecting no drift whatsoever.
 *
 * ## Capabilities are NOT here, and that is measured
 *
 * `capabilities` is a field of the DEFINITION, not of `CompiledAgentOptions` — the compiler resolves
 * it into tools rather than carrying it through. The DoD named it, and projecting it would have
 * meant reading the definition instead of the compilation, which is a different assertion wearing
 * this function's name: it would report what the author WROTE, not what the agent GOT.
 *
 * This projects the three facts a test actually asserts. It is a READ over the real compiler — never
 * a second one — so a compilation change surfaces here rather than in a fixture that agreed with an
 * older version of the truth.
 */

/** The facts a test asserts about a compiled agent. */
export interface CompiledInspection {
  /** Tool names, sorted, as the model will see them. */
  readonly toolNames: readonly string[]
  /** Names of the tools that require human approval before running. */
  readonly gatedToolNames: readonly string[]
  /** The model the agent will use, when one is declared. */
  readonly model: string | undefined
}

/**
 * Inspect what a definition compiles to.
 *
 * ```ts
 * expect(inspectCompiled(myAgent).gatedToolNames).toContain('run_shell')
 * ```
 *
 * Sorted output, because a list whose order changes with a decorator's position is a list nobody can
 * diff — and a test that pinned that order would fail on a reordering that changed nothing.
 */
export function inspectCompiled(definition: AgentDefinition): CompiledInspection {
  const compiled = compileAgentDefinition(definition)
  const toolNames = compiled.tools.map((tool) => tool.name).sort((a, b) => a.localeCompare(b))
  const gatedToolNames = [...(compiled.hitl?.keys() ?? [])].sort((a, b) => a.localeCompare(b))
  return {
    toolNames,
    gatedToolNames,
    model: typeof compiled.model === 'string' ? compiled.model : undefined,
  }
}
