// #1855 — kept out of sdk-adapter.ts on purpose: that file is already ~990 lines (lint max-lines is 500), and the
// advertised-mode reader plus its PATH check are self-contained.
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

import type { InlineSkill } from '@theokit/sdk'
import type { Skill } from '@theokit/sdk/skills'

import type { CompiledAgentOptions } from './agent-compiler.js'
import { BUILD_WIRED_SKILL_READERS } from './compiled-wiring.js'

/** What the SDK agent exposes of its own skills: the public listing, and the manager behind it. */
interface ListsSkills {
  /** The `SkillsManager` the SDK builds every `<skills>` listing from; `refresh()` re-reads it. */
  readonly skillsManager?: {
    /** True only when the trust gate granted the project root; a refresh then re-reads it legitimately. */
    readonly settingSourcesIncludeProject?: boolean
    readonly list: () => Promise<readonly (Skill | InlineSkill)[]>
  }
}

type ReadSource = () => Promise<readonly (InlineSkill | Skill)[]>

/** The runtime surface this wiring needs; `SdkRuntime` satisfies it structurally. */
interface WireRuntime {
  Agent: { getOrCreate: (id: string, opts: Record<string, unknown>) => Promise<unknown> }
  defineSkillReadTool?: (source: readonly InlineSkill[] | ReadSource) => unknown
}

/**
 * The SDK's own binary gate, `binaryOnPath` from `@theokit/sdk/skills` (exported since 10.0.0). An older SDK
 * does not export it: a local PATH lookup then stands in, so a skill whose binary is present is still served.
 */
function localBinaryOnPath(bin: string): boolean {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const ext of exts) {
      try {
        accessSync(join(dir, bin + ext), constants.X_OK)
        return true
      } catch {
        // not here; keep looking
      }
    }
  }
  return false
}

async function binaryGate(): Promise<(bin: string) => boolean> {
  const skills = (await import('@theokit/sdk/skills')) as {
    binaryOnPath?: (bin: string) => boolean
  }
  return skills.binaryOnPath ?? localBinaryOnPath
}

/**
 * The SDK's own disclosure rule for the `<skills>` block (hidden and unrunnable skills are not offered). The SDK
 * exposes no API for the flags, so the rule is mirrored here over the SDK's binary gate; the real-SDK cases in
 * skill-read-autowire.test.ts pin the manager it reads.
 */
function isDisclosed(skill: Skill | InlineSkill, onPath: (bin: string) => boolean): boolean {
  const s = skill as { disableModelInvocation?: boolean; requiresBins?: string[] }
  return s.disableModelInvocation !== true && (s.requiresBins ?? []).every(onPath)
}

interface Holder {
  agent?: ListsSkills
  /** Keys of the skills the manager listed when the agent was created: the post-trust-gate roots. */
  roots?: Set<string>
}

/** A filesystem skill is identified by its file; an inline one has none, so by name. */
function skillKey(s: Skill | InlineSkill): string {
  return (s as { source?: string }).source ?? `inline:${s.name}`
}

/**
 * #1855 — the skills `skill_read` serves in `'advertised'` mode, read on EVERY call from the SDK
 * agent's own skills manager: the same live snapshot the `<skills>` block is built from, so the trust
 * gate, `skills.enabled`, compat roots, plugin bundles, root precedence AND a later refresh are the
 * SDK's resolution, not a second one. Nothing is re-discovered from disk here; the disclosure flags
 * come from the manager's own skills. A refresh (`agent.reload()`) re-discovers project roots even
 * when the trust gate withheld them at creation, so when the gate withheld the project root only the skills the manager listed
 * at creation (keyed by source file) stay readable, and when it granted it the current snapshot is served; their bodies and flags still follow refreshes.
 * Without the manager (a peer that hides it) nothing is served: the public
 * listing lacks the disclosure flags, so it cannot tell a hidden skill from a listed one.
 *
 * A function-valued `skills` never reaches the SDK from this bridge: the request path resolves it to a
 * static `enabled` list first, so the agent's manager is the one every listing is built from.
 */
async function advertisedSkills(holder: Holder): Promise<(InlineSkill | Skill)[]> {
  const manager = holder.agent?.skillsManager
  if (manager !== undefined && holder.roots !== undefined) {
    const roots = holder.roots
    // Project roots granted: the manager's current snapshot IS the listing, new skills included.
    // Withheld: a refresh would still discover them, so only the creation-time set is served.
    const granted = manager.settingSourcesIncludeProject === true
    const onPath = await binaryGate()
    return (await manager.list()).filter(
      (s) => (granted || roots.has(skillKey(s))) && isDisclosed(s, onPath),
    )
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
    if (inline !== undefined && inline.length > 0) {
      const reader = define(inline)
      if (typeof reader === 'object' && reader !== null)
        BUILD_WIRED_SKILL_READERS.set(reader, 'inline')
      sdkTools.push(reader)
    }
    return rt
  }
  // Resolved on each read from the agent the SDK built, so it follows the manager's current snapshot.
  const holder: Holder = {}
  const reader = define(() => advertisedSkills(holder))
  if (typeof reader === 'object' && reader !== null)
    BUILD_WIRED_SKILL_READERS.set(reader, 'advertised')
  sdkTools.push(reader)
  return {
    ...rt,
    Agent: {
      ...rt.Agent,
      getOrCreate: async (id, opts) => {
        const agent = await rt.Agent.getOrCreate(id, opts)
        holder.agent = agent as ListsSkills
        const listed = await holder.agent.skillsManager?.list()
        if (listed !== undefined) holder.roots = new Set(listed.map(skillKey))
        return agent
      },
    },
  }
}
