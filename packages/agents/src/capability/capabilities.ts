import type { InlineSkill } from '@theokit/sdk'

import type { CompiledTool } from '../bridge/agent-compiler.js'
import { compileSkillsSelection } from '../bridge/define-agent.js'
import { ConfigurationError } from '../errors.js'

import { type Capability, type CompiledAgentOptionsDraft, setOnce } from './capability.js'

/**
 * M52 — three real capabilities proving the contract against genuine variation: one that VALIDATES and
 * can conflict (model), one that ACCUMULATES (tools), and one that is pure DATA (skills — a plain
 * factory, because a class with no behavior would be ceremony: KISS).
 */

// `ConfigurationError` lives in `../errors.js` and is imported above. The M55 compatibility
// re-export from this module is GONE (M56): a second import path for one class is exactly the kind
// of concession that keeps dead surface alive. Import it from where it is defined.

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
    // The reference compiler accepts `string | InlineSkill` (define-agent.ts § compileSkillsSelection),
    // so inline skills must be accepted here too — rejecting them outright would make this layer less
    // expressive than the path it claims equivalence with.
    //
    // ONE deliberate asymmetry, stated rather than glossed over: an inline skill with an empty
    // `instructions` compiles through `defineAgent` but is REJECTED here. That object's body is
    // unreachable at runtime (`SkillsManager.get` would fall back to `readFile(source)`, and a
    // hand-rolled inline has no real `source`), so this rejects a broken agent at authoring time
    // instead of at prompt-assembly time. It is an input rejection, never an output divergence.
    if (typeof e === 'string') {
      if (e.trim().length === 0) {
        throw new ConfigurationError('skills: nome vazio — use um nome de skill não vazio')
      }
      continue
    }
    if (typeof e !== 'object' || e === null || Array.isArray(e)) {
      throw new ConfigurationError(
        `skills: entrada inválida (${describe(e)}) — use um nome ou um skill inline`,
      )
    }
    // An inline skill reaches the `<skills>` system-prompt block. Accepting `{ name }` alone lets a
    // malformed skill through with `undefined` description/instructions — the same silent
    // corruption this boundary exists to stop, one level down. `InlineSkill extends Skill` requires
    // all three (`@theokit/sdk` create-skill.d.ts + discover-skills.d.ts).
    for (const field of ['name', 'description', 'instructions'] as const) {
      const value = (e as Record<string, unknown>)[field]
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new ConfigurationError(
          `skills: skill inline sem \`${field}\` válido (${describe(value)}) — ` +
            'name, description e instructions são obrigatórios',
        )
      }
    }
  }
  return {
    name: 'skills',
    apply: (draft) => {
      // DELEGA ao compilador canônico (não reimplementa): `autoInject`, skills inline e o caminho
      // resolver vivem numa fonte só — reimplementar aqui divergiria (foi o que a prova de
      // equivalência pegou).
      const compiled = compileSkillsSelection(entries.slice())
      if (compiled.skills === undefined) return
      // ACCUMULATES, never setOnce: skills is a merge-semantics field in the reference compiler
      // (`defineAgent({skills:['a','b']})` → `['a','b']`). With setOnce a preset's baseline skills
      // could never be extended at the call site — defeating the whole point of the Composite.
      //
      // CONCAT, never dedupe. The capability list IS the authoring list: `skills(['a']) +
      // skills(['a'])` corresponds to authoring `['a','a']`, which the reference compiler maps to
      // `['a','a']`. A dedupe here looks tidier but makes the merge path the ONLY place in this
      // layer that diverges from the reference — the exact thing the milestone exists to prevent.
      const previous = draft.skills
      draft.skills =
        previous === undefined
          ? compiled.skills
          : {
              // The spread is exhaustive only because `compileSkillsSelection` emits a FIXED 3-key
              // shape (`enabled`, `autoInject: true`, and `inline` iff non-empty) — `enabled` and
              // `inline` are both re-derived below, and `autoInject` is the same literal on both
              // sides. TRAP for the future: if a capability ever authors `autoInject: false`, this
              // spread would silently normalize it back to `true`. Unreachable today (no capability
              // and no reference array form can express it) — revisit when one can.
              ...previous,
              ...compiled.skills,
              enabled: [...(previous.enabled ?? []), ...(compiled.skills.enabled ?? [])],
              ...(previous.inline !== undefined || compiled.skills.inline !== undefined
                ? { inline: [...(previous.inline ?? []), ...(compiled.skills.inline ?? [])] }
                : {}),
            }
      draft.provenance.push({ capability: 'skills', contributed: ['skills'] })
    },
  }
}
