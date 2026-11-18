import { accessSync, constants } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

import type { InlineSkill } from '@theokit/sdk'
import type { Skill } from '@theokit/sdk/skills'

import type { CompiledAgentOptions } from './agent-compiler.js'

/** What the SDK agent exposes of its own skill listing (`SDKAgent.skills`). */
interface ListsSkills {
  readonly skills?: {
    readonly list: () => Promise<readonly { name: string; source?: string }[]>
  }
}

type ReadSource = () => Promise<readonly (InlineSkill | Skill)[]>

/** The runtime surface this wiring needs; `SdkRuntime` satisfies it structurally. */
interface WireRuntime {
  Agent: { getOrCreate: (id: string, opts: Record<string, unknown>) => Promise<unknown> }
  defineSkillReadTool?: (source: readonly InlineSkill[] | ReadSource) => unknown
}

/** Same extension set the SDK tries: bare name, plus `PATHEXT` on Windows. */
function executableExtensions(): string[] {
  return process.platform === 'win32'
    ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD').split(';')]
    : ['']
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function binaryOnPath(bin: string): boolean {
  if (bin.length === 0 || /[\\/]/.test(bin)) return false
  return (process.env.PATH ?? '')
    .split(delimiter)
    .filter((d) => d.length > 0)
    .some((d) => executableExtensions().some((ext) => isExecutable(join(d, bin + ext))))
}

/** The SDK's own disclosure rule for the `<skills>` block: hidden and unrunnable skills are not offered. */
function isDisclosed(skill: Skill | InlineSkill): boolean {
  const s = skill as { disableModelInvocation?: boolean; requiresBins?: string[] }
  return s.disableModelInvocation !== true && (s.requiresBins ?? []).every(binaryOnPath)
}

/**
 * #1855 — the skills `skill_read` serves in `'advertised'` mode, read from the SDK agent's OWN
 * listing (`agent.skills.list()`), so the trust gate, `skills.enabled`, compat roots, plugin bundles
 * and root precedence are the SDK's resolution, not a second one. The listing drops the disclosure
 * flags, so each skill is re-read from its `SKILL.md` root with the SDK's `discoverSkills` and the
 * `<skills>` block's disclosure rule is applied. Inline skills win a name clash, as in the SDK.
 */
async function advertisedSkills(
  agent: ListsSkills | undefined,
  compiled: CompiledAgentOptions,
): Promise<(InlineSkill | Skill)[]> {
  const listed = (await agent?.skills?.list()) ?? []
  const { discoverSkills } = await import('@theokit/sdk/skills')
  const inline = new Map((compiled.skills?.inline ?? []).map((s) => [s.name, s]))
  const out: (InlineSkill | Skill)[] = []
  for (const entry of listed) {
    const own = inline.get(entry.name)
    if (own !== undefined) {
      if (isDisclosed(own)) out.push(own)
      continue
    }
    if (entry.source === undefined) continue
    const full = (await discoverSkills(dirname(dirname(entry.source)))).find(
      (s) => s.name === entry.name && s.source === entry.source,
    )
    if (full !== undefined && isDisclosed(full)) out.push(full)
  }
  return out
}

/**
 * Auto-wire `skill_read`. Inline mode (default): an inline skill lists by name + description only,
 * so registering one implies wanting it readable. `'advertised'` (#1855): everything the `<skills>`
 * block lists, resolved lazily from the agent the SDK builds. Skipped when the effective tool list
 * (compiled tools and per-run `sdkTools`) already carries a `skill_read`, or when the loaded SDK
 * predates `defineSkillReadTool`. Returns the runtime to create the agent with.
 */
export function wireInlineSkillRead<R extends WireRuntime>(
  sdkTools: unknown[],
  rt: R,
  compiled: CompiledAgentOptions,
): R {
  const define = rt.defineSkillReadTool
  if (
    define === undefined ||
    sdkTools.some((t) => (t as { name?: string }).name === 'skill_read')
  ) {
    return rt
  }
  if (compiled.skillsRead !== 'advertised') {
    const inline = compiled.skills?.inline
    if (inline !== undefined && inline.length > 0) sdkTools.push(define(inline))
    return rt
  }
  // The set is resolved ONCE, right after the SDK builds the agent, so it is the snapshot the
  // `<skills>` block was built from; a later edit to a SKILL.md cannot widen what is readable.
  const holder: { snapshot?: Promise<(InlineSkill | Skill)[]> } = {}
  sdkTools.push(define(async () => (await holder.snapshot) ?? []))
  return {
    ...rt,
    Agent: {
      ...rt.Agent,
      getOrCreate: async (id, opts) => {
        const agent = await rt.Agent.getOrCreate(id, opts)
        holder.snapshot = advertisedSkills(agent as ListsSkills, compiled)
        holder.snapshot.catch(() => undefined) // surfaced when read, not as an unhandled rejection
        await holder.snapshot.catch(() => undefined) // settle before the agent is handed out
        return agent
      },
    },
  }
}
