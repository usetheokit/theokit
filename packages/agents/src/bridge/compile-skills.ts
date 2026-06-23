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

import type { SkillsOptions } from '../decorators/skills.js'

export function compileSkills(options: SkillsOptions): SkillsSettings {
  if (options.autoDiscover) {
    return { autoInject: true }
  }
  return { enabled: options.include, autoInject: true }
}
