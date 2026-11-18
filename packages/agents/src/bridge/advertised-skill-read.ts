import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

import type { InlineSkill } from '@theokit/sdk'
import type { Skill } from '@theokit/sdk/skills'

import type { CompiledAgentOptions } from './agent-compiler.js'

/** What the SDK agent exposes of its own skills: the public listing, and the manager behind it. */
interface ListsSkills {
  /** The `SkillsManager` the SDK builds every `<skills>` listing from; `refresh()` re-reads it. */
  readonly skillsManager?: { readonly list: () => Promise<readonly (Skill | InlineSkill)[]> }
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
 * #1855 — the skills `skill_read` serves in `'advertised'` mode, read on EVERY call from the SDK
 * agent's own skills manager: the same live snapshot the `<skills>` block is built from, so the trust
 * gate, `skills.enabled`, compat roots, plugin bundles, root precedence AND a later refresh are the
 * SDK's resolution, not a second one. Nothing is re-discovered from disk here; the disclosure flags
 * come from the manager's own skills. Without the manager (a peer that hides it) nothing is served: the public
 * listing lacks the disclosure flags, so it cannot tell a hidden skill from a listed one.
 *
 * A function-valued `skills` never reaches the SDK from this bridge: the request path resolves it to a
 * static `enabled` list first, so the agent's manager is the one every listing is built from.
 */
async function advertisedSkills(agent: ListsSkills | undefined): Promise<(InlineSkill | Skill)[]> {
  if (agent?.skillsManager !== undefined) {
    return (await agent.skillsManager.list()).filter(isDisclosed)
  }
  // Fail closed: the public listing carries no disclosure flags, so without the manager nothing is served.
  return []
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
  // Resolved on each read from the agent the SDK built, so it follows the manager's current snapshot.
  const holder: { agent?: ListsSkills } = {}
  sdkTools.push(define(() => advertisedSkills(holder.agent)))
  return {
    ...rt,
    Agent: {
      ...rt.Agent,
      getOrCreate: async (id, opts) => {
        const agent = await rt.Agent.getOrCreate(id, opts)
        holder.agent = agent as ListsSkills
        return agent
      },
    },
  }
}
