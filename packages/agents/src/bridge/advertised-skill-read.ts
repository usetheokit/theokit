import { homedir } from 'node:os'
import { join } from 'node:path'

import type { InlineSkill } from '@theokit/sdk'

import { readdirSyncSafe } from './advertised-skill-roots.js'
import type { CompiledAgentOptions, CompiledTool } from './agent-compiler.js'

/**
 * #1855 — the roots the `<skills>` block is drawn from, in the SDK's precedence order (first wins):
 * project `.theokit`, the `claude-code` compat root, the operator's `~/.theokit`, then plugin bundles.
 * Only roots the compiled definition was granted are returned: `settingSources` and `compatSources`
 * hold post-trust-gate values (branded, mintable only by `resolveSettingSources`), so a root the gate
 * withheld is simply absent and is never read.
 */
export function advertisedSkillRoots(
  compiled: CompiledAgentOptions,
  cwd: string,
  home: string = homedir(),
): string[] {
  const sources: readonly string[] = compiled.settingSources ?? []
  const project = sources.includes('project')
  const compat = (compiled.compatSources ?? []).some(
    (s) => typeof s === 'string' || s.import.includes('skills'),
  )
  const roots: string[] = []
  if (project) roots.push(join(cwd, '.theokit', 'skills'))
  if (compat) roots.push(join(cwd, '.claude', 'skills'))
  if (sources.includes('user')) roots.push(join(home, '.theokit', 'skills'))
  if (project || compat) {
    for (const base of project ? ['.theokit', '.claude'] : ['.claude']) {
      for (const bundle of readdirSyncSafe(join(cwd, base, 'plugins'))) {
        roots.push(join(cwd, base, 'plugins', bundle, 'skills'))
      }
    }
  }
  return roots
}

/**
 * The skills `skill_read` serves in `'advertised'` mode: the inline skills plus every skill found
 * under {@link advertisedSkillRoots}, narrowed by `skills.enabled` when one was set (the SDK lists
 * only those). Discovery and body loading are the SDK's own; the first root to define a name wins.
 */
export async function resolveAdvertisedSkills(
  compiled: CompiledAgentOptions,
  cwd: string,
): Promise<InlineSkill[]> {
  const { discoverSkills, loadSkillInstructions } = await import('@theokit/sdk/skills')
  const enabled = compiled.skills?.enabled
  const byName = new Map<string, InlineSkill>()
  for (const skill of compiled.skills?.inline ?? []) byName.set(skill.name, skill)
  for (const root of advertisedSkillRoots(compiled, cwd)) {
    // `discoverSkills` yields `[]` for a missing or unreadable root.
    for (const skill of await discoverSkills(root)) {
      if (byName.has(skill.name)) continue
      if (enabled !== undefined && enabled.length > 0 && !enabled.includes(skill.name)) continue
      byName.set(skill.name, { ...skill, instructions: await loadSkillInstructions(skill) })
    }
  }
  return [...byName.values()]
}

/**
 * Auto-wire `skill_read` for inline skills (`defineAgent({ skills: [inlineSkill] })`). An inline
 * skill lists in the `<skills>` block by name + description only — its body is unreachable to the
 * model without the `skill_read` tool, so registering an inline skill implies wanting it readable.
 * Dedup: skip when the app already declared a `skill_read` (an explicit `defineSkillReadTool` wins).
 * Graceful: skip when the loaded SDK predates `defineSkillReadTool`.
 */
export async function wireInlineSkillRead(
  sdkTools: unknown[],
  defineSkillReadTool: ((skills: readonly InlineSkill[]) => unknown) | undefined,
  compiled: CompiledAgentOptions,
  compiledTools: CompiledTool[],
  cwd?: string,
): Promise<void> {
  if (defineSkillReadTool === undefined || compiledTools.some((t) => t.name === 'skill_read')) {
    return
  }
  // #1855 — `'advertised'`: serve what the `<skills>` block lists, resolved over the post-gate roots.
  const skills =
    compiled.skillsRead === 'advertised'
      ? await resolveAdvertisedSkills(compiled, cwd ?? process.cwd())
      : compiled.skills?.inline
  if (skills !== undefined && skills.length > 0) sdkTools.push(defineSkillReadTool(skills))
}
