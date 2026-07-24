/**
 * M8-3 — compile `@Skills` metadata into the SDK's `SkillsSettings`.
 *
 * Per sdk-runtime.md: the bridge COMPILES decorator metadata into a format the
 * SDK accepts; the SDK is the runtime. `Agent.create({ skills })` natively
 * discovers `.theokit/skills/<name>/SKILL.md` files and injects the `<skills>`
 * block — so giving `@Skills` runtime is a pure shape translation, not a
 * reimplementation of discovery.
 *
 * Mapping (ADR D4):
 * - `{ include }`            → `{ enabled: include, autoInject: true }`
 * - `{ autoDiscover: true }` → `{ autoInject: true }` (enabled omitted ⇒ the SDK
 *                              enables every discovered skill)
 */
import type { SkillsSettings } from '@theokit/sdk'

/**
 * M53 — the options shape lives WITH its conversion now. It used to be declared on the decorator
 * that is being deleted, which would have taken a type the compiler needs down with it.
 */
export interface SkillsOptions {
  /** Skill names to include (resolved from `.theokit/skills/<name>/SKILL.md`). */
  include: string[]
  /** Auto-discover every skill under `.theokit/skills/` (default: false). */
  autoDiscover?: boolean
}

export function compileSkills(options: SkillsOptions): SkillsSettings {
  if (options.autoDiscover) {
    return { autoInject: true }
  }
  return { enabled: options.include, autoInject: true }
}
