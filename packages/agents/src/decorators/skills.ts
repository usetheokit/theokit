/**
 * @Skills() — declares markdown skill files injected into the agent's system prompt.
 *
 * Compiles to SDK's SkillsSettings in Agent.create({ skills }).
 * Skills are .theokit/skills/<name>/SKILL.md files discovered at agent creation.
 *
 * @example
 * ```ts
 * @Agent({ name: 'support', route: '/api/agents/support' })
 * @Skills(['customer-service', 'refund-policy', 'escalation-protocol'])
 * class SupportAgent { ... }
 * ```
 */
import type { SkillsOptions } from '../bridge/compile-skills.js'
import { setMeta, getMeta } from '../metadata/index.js'

const SKILLS_CONFIG = Symbol.for('theokit:agents:skills')

export type { SkillsOptions } from '../bridge/compile-skills.js'

export function Skills(namesOrOptions: string[] | SkillsOptions): ClassDecorator {
  return (target: Function) => {
    const options: SkillsOptions = Array.isArray(namesOrOptions)
      ? { include: namesOrOptions, autoDiscover: false }
      : namesOrOptions
    setMeta(SKILLS_CONFIG, target, options)
  }
}

export function getSkillsConfig(target: Function): SkillsOptions | undefined {
  return getMeta<SkillsOptions>(SKILLS_CONFIG, target)
}
