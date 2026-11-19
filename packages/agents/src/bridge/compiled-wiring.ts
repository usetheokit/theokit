/**
 * The compiled wiring of an agent: what was handed to `Agent.create`, read back from those options.
 *
 * Derived from the FINAL options object, never from a second read of the inputs, so a status panel
 * cannot disagree with the build.
 */

/** What an agent was built with, as reported to `onWired`. */
export interface CompiledWiring {
  /** Tool names handed to `Agent.create`, with withheld builtins removed. SDK defaults are not enumerated. */
  readonly tools: readonly string[]
  readonly skills: {
    /** Skills the created agent resolved (`agent.skills.list()`): project and user skills only when their source was granted. */
    readonly listed: readonly string[]
    /** Inline skills a `skill_read` tool wired by this build serves. A caller-supplied `skill_read` is opaque, so it reports none. */
    readonly readable: readonly string[]
  }
  readonly mcpServers: readonly string[]
  readonly hooks: readonly { readonly event: string; readonly matcher?: string }[]
  readonly subagents: readonly string[]
  readonly settingSources: { readonly project: boolean; readonly user: boolean }
  readonly withheldBuiltinTools: readonly string[]
}

/** Plugins built by this layer carry the hook events they register here; the SDK hides them inside `register`. */
export const WIRED_HOOKS: unique symbol = Symbol.for('theokit.agents.wiredHooks')

/** The `onWired` listener rides on the builder's plugin, so it reaches the final options intact. */
export const WIRED_LISTENER: unique symbol = Symbol.for('theokit.agents.wiredListener')

/** `skill_read` tools this build created, so `readable` is reported only for a reader whose set is known. */
export const BUILD_WIRED_SKILL_READERS = new WeakSet()

type Loose = Record<string, unknown> | undefined
type Listener = (wiring: CompiledWiring) => void

const names = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.flatMap((e) => {
        const n = typeof e === 'string' ? e : (e as { name?: unknown } | null)?.name
        return typeof n === 'string' ? [n] : []
      })
    : []

const pluginsOf = (options: Record<string, unknown>): (Record<symbol, unknown> | null)[] =>
  Array.isArray(options.plugins) ? (options.plugins as (Record<symbol, unknown> | null)[]) : []

function hooksOf(options: Record<string, unknown>): CompiledWiring['hooks'] {
  return pluginsOf(options).flatMap((p) => {
    const list = p?.[WIRED_HOOKS]
    return Array.isArray(list) ? (list as CompiledWiring['hooks']) : []
  })
}

function listenerOf(options: Record<string, unknown>): Listener | undefined {
  for (const p of pluginsOf(options)) {
    const l = p?.[WIRED_LISTENER]
    if (typeof l === 'function') return l as Listener
  }
  return undefined
}

/** The skills the created agent resolved; `undefined` handle (skills never turned on) means none. */
async function resolvedSkills(agent: unknown): Promise<string[]> {
  const handle = (agent as { skills?: { list?: () => Promise<unknown> } } | null)?.skills
  if (typeof handle?.list !== 'function') return []
  try {
    return names(await handle.list())
  } catch {
    return []
  }
}

/** Read the wiring from the options as they reached `Agent.create`, and skills from the created agent. */
async function readCompiledWiring(
  options: Record<string, unknown>,
  agent: unknown,
): Promise<CompiledWiring> {
  const tools = Array.isArray(options.tools) ? (options.tools as object[]) : []
  const withheld = Array.isArray(options.withheldBuiltinTools)
    ? (options.withheldBuiltinTools as string[])
    : []
  const skills = options.skills as Loose
  const listed = [...new Set(await resolvedSkills(agent))]
  const reader = tools.find(
    // eslint-disable-next-line sonarjs/no-empty-collection -- populated by sdk-adapter.ts
    (t) => (t as { name?: unknown }).name === 'skill_read' && BUILD_WIRED_SKILL_READERS.has(t),
  )
  const sources = ((options.local as Loose)?.settingSources as string[] | undefined) ?? []
  return {
    // Caller-supplied tools only: a custom tool may deliberately replace a withheld builtin.
    tools: names(tools),
    skills: {
      listed,
      readable: reader !== undefined ? names(skills?.inline).filter((n) => listed.includes(n)) : [],
    },
    mcpServers: Object.keys((options.mcpServers as object | undefined) ?? {}),
    hooks: hooksOf(options),
    subagents: Object.keys((options.agents as object | undefined) ?? {}),
    settingSources: { project: sources.includes('project'), user: sources.includes('user') },
    withheldBuiltinTools: [...withheld],
  }
}

async function reportWiring(
  listener: Listener,
  options: Record<string, unknown>,
  agent: unknown,
): Promise<void> {
  try {
    listener(await readCompiledWiring(options, agent))
  } catch (err) {
    console.warn('[theokit] onWired listener threw; the agent was still built:', err)
  }
}

interface AgentStatics {
  getOrCreate(id: string, options: never): Promise<unknown>
}

/**
 * `Agent.getOrCreate`, always — so the SDK's live-agent cache and in-flight registry apply with or
 * without a listener. The listener runs only when THIS call created the agent: the SDK invokes
 * `onBeforeCreate` on the create path alone (not on a cache hit, a resume, or a concurrent caller
 * that shares the winner's in-flight build), so that hook is the creation signal.
 */
export async function getOrCreateReporting(
  sdk: unknown,
  sessionId: string,
  options: Record<string, unknown>,
): Promise<unknown> {
  const statics = sdk as AgentStatics
  const listener = listenerOf(options)
  if (listener === undefined) return statics.getOrCreate(sessionId, options as never)
  let created = false as boolean
  const prior = options.onBeforeCreate as ((info: unknown) => unknown) | undefined
  const wrapped = {
    ...options,
    onBeforeCreate: async (info: unknown) => {
      await prior?.(info)
      created = true
    },
  }
  const agent = await statics.getOrCreate(sessionId, wrapped as never)
  if (created) await reportWiring(listener, options, agent)
  return agent
}
