import type { InlineSkill } from '@theokit/sdk'

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

/** Human-readable type of a rejected value — never its content (config files may hold secrets). */
function describe(value: unknown): string {
  if (value === null) return 'null'
  return Array.isArray(value) ? 'array' : typeof value
}

/** Sets the model id (and optional reasoning effort). CLASS: it validates and can conflict. */
export class ModelCapability implements Capability {
  readonly name = 'model'
  constructor(
    private readonly id: string,
    private readonly reasoningEffort?: CompiledAgentOptionsDraft['reasoningEffort'],
  ) {
    // Boundary validation: the registry hands `unknown` straight from a config FILE, so a wrong
    // type must fail here, typed and named — not as a raw `id.trim is not a function` three frames
    // deep (rules/error-handling.md § 2: validate at the boundary, fail typed).
    if (typeof id !== 'string') {
      throw new ConfigurationError(`model: esperava string, recebi ${describe(id)}`)
    }
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
export const skills = (entries: readonly (string | InlineSkill)[]): Capability => {
  // Boundary validation BEFORE anything spreads: a config file carrying `skills: "code-review"`
  // would otherwise spread into eleven single-character skill names and reach Agent.create with no
  // error at all — silent corruption, the worst failure mode for file-based authoring.
  if (!Array.isArray(entries)) {
    throw new ConfigurationError(`skills: esperava array de nomes, recebi ${describe(entries)}`)
  }
  for (const e of entries) {
    // The reference compiler accepts `string | InlineSkill` (define-agent.ts § compileSkillsSelection);
    // rejecting inline skills here would make this layer strictly LESS expressive than the path it
    // claims equivalence with.
    const isName = typeof e === 'string' && e.trim().length > 0
    const isInline =
      typeof e === 'object' && e !== null && typeof (e as InlineSkill).name === 'string'
    if (!isName && !isInline) {
      throw new ConfigurationError(
        `skills: entrada inválida (${describe(e)}) — use um nome não vazio ou um skill inline com \`name\``,
      )
    }
  }
  return {
    name: 'skills',
    apply: (draft) => {
      // DELEGA ao compilador canônico (não reimplementa): `autoInject`, skills inline e o caminho
      // resolver vivem numa fonte só — reimplementar aqui divergiria (foi o que a prova de
      // equivalência pegou).
      const compiled = compileSkillsSelection([...entries])
      if (compiled.skills === undefined) return
      // ACCUMULATES, never setOnce: skills is a merge-semantics field in the reference compiler
      // (`defineAgent({skills:['a','b']})` → `['a','b']`). With setOnce a preset's baseline skills
      // could never be extended at the call site — defeating the whole point of the Composite.
      // DEDUPED: composition must never MANUFACTURE a duplicate the author never wrote (two
      // capabilities each enabling 'a' means 'a' is enabled, not enabled twice).
      const previous = draft.skills
      draft.skills =
        previous === undefined
          ? compiled.skills
          : {
              ...previous,
              ...compiled.skills,
              enabled: [
                ...new Set([...(previous.enabled ?? []), ...(compiled.skills.enabled ?? [])]),
              ],
              ...(previous.inline !== undefined || compiled.skills.inline !== undefined
                ? { inline: [...(previous.inline ?? []), ...(compiled.skills.inline ?? [])] }
                : {}),
            }
      draft.provenance.push({ capability: 'skills', contributed: ['skills'] })
    },
  }
}
