import type { CompiledTool } from '../bridge/agent-compiler.js'
import { compileSkillsSelection } from '../bridge/define-agent.js'

import { type Capability, type CompiledAgentOptionsDraft, setOnce } from './capability.js'

/**
 * M52 — three real capabilities proving the contract against genuine variation: one that VALIDATES and
 * can conflict (model), one that ACCUMULATES (tools), and one that is pure DATA (skills — a plain
 * factory, because a class with no behavior would be ceremony: KISS).
 */

/** Typed authoring failure — surfaced at build time, never a silent bad agent. */
export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError'
}

/** Sets the model id (and optional reasoning effort). CLASS: it validates and can conflict. */
export class ModelCapability implements Capability {
  readonly name = 'model'
  constructor(
    private readonly id: string,
    private readonly reasoningEffort?: CompiledAgentOptionsDraft['reasoningEffort'],
  ) {
    if (id.trim().length === 0) throw new ConfigurationError('model: id não pode ser vazio')
  }
  apply(draft: CompiledAgentOptionsDraft): void {
    setOnce(draft, 'model', this.id, this.name)
    if (this.reasoningEffort !== undefined) {
      setOnce(draft, 'reasoningEffort', this.reasoningEffort, this.name)
    }
  }
}

/** Adds tools. CLASS: it ACCUMULATES (never overwrites), which is behavior worth owning. */
export class ToolsCapability implements Capability {
  readonly name = 'tools'
  readonly #tools: readonly CompiledTool[]
  constructor(tools: readonly CompiledTool[]) {
    this.#tools = tools
  }
  apply(draft: CompiledAgentOptionsDraft): void {
    draft.tools.push(...this.#tools)
    draft.provenance.push({ capability: this.name, contributed: ['tools'] })
  }
}

/**
 * Enables skills by name. FUNCTION, not class: it carries no behavior beyond assignment — a class here
 * would be ceremony (the honest counter-example to "everything must be a class").
 */
export const skills = (names: readonly string[]): Capability => ({
  name: 'skills',
  apply: (draft) => {
    // DELEGA ao compilador canônico (não reimplementa): `autoInject`, skills inline e o caminho
    // resolver vivem numa fonte só — reimplementar aqui divergiria (foi o que a prova de
    // byte-identidade pegou).
    const compiled = compileSkillsSelection([...names])
    if (compiled.skills !== undefined) setOnce(draft, 'skills', compiled.skills, 'skills')
    if (compiled.skillsResolver !== undefined)
      setOnce(draft, 'skillsResolver', compiled.skillsResolver, 'skills')
  },
})
