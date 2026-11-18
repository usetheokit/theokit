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
    /** Skills the created agent resolved (`agent.skills.list()`); inline skills when the handle exposes none. */
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

/** `skill_read` tools this build created, so `readable` is reported only for a reader whose set is known. */

export const BUILD_WIRED_SKILL_READERS = new WeakSet()

type Loose = Record<string, unknown> | undefined

const names = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.flatMap((e) => {
        const n = typeof e === 'string' ? e : (e as { name?: unknown } | null)?.name
        return typeof n === 'string' ? [n] : []
      })
    : []

function hooksOf(plugins: unknown): CompiledWiring['hooks'] {
  if (!Array.isArray(plugins)) return []
  return plugins.flatMap((p: unknown) => {
    const list = (p as Record<symbol, unknown> | null)?.[WIRED_HOOKS]
    return Array.isArray(list) ? (list as CompiledWiring['hooks']) : []
  })
}

/** Read the wiring from the options exactly as they reach `Agent.create`. */
export function readCompiledWiring(
  options: Record<string, unknown>,
  resolved?: readonly string[],
): CompiledWiring {
  const tools = Array.isArray(options.tools) ? (options.tools as object[]) : []
  const withheld = Array.isArray(options.withheldBuiltinTools)
    ? (options.withheldBuiltinTools as string[])
    : []
  const skills = options.skills as Loose
  const inline = names(skills?.inline)
  const reader = tools.find(
    // eslint-disable-next-line sonarjs/no-empty-collection -- populated by sdk-adapter.ts
    (t) => (t as { name?: unknown }).name === 'skill_read' && BUILD_WIRED_SKILL_READERS.has(t),
  )
  const sources = ((options.local as Loose)?.settingSources as string[] | undefined) ?? []
  return {
    // Caller-supplied tools only: a custom tool may deliberately replace a withheld builtin.
    tools: names(tools),
    skills: {
      // The agent's own resolved skills (disk roots its settingSources grant, plus inline); a name
      // that does not exist or is invalid never appears. Without a skills handle only inline skills.
      listed: resolved !== undefined ? [...new Set(resolved)] : [...new Set(inline)],
      readable: reader !== undefined ? inline.filter((n) => resolved?.includes(n) ?? true) : [],
    },
    mcpServers: Object.keys((options.mcpServers as object | undefined) ?? {}),
    hooks: hooksOf(options.plugins),
    subagents: Object.keys((options.agents as object | undefined) ?? {}),
    settingSources: { project: sources.includes('project'), user: sources.includes('user') },
    withheldBuiltinTools: [...withheld],
  }
}

/** Report the wiring; a throwing listener is warned about and never fails the build. */
export function reportWiring(
  listener: ((wiring: CompiledWiring) => void) | undefined,
  options: Record<string, unknown>,
  resolved?: readonly string[],
): void {
  if (listener === undefined) return
  try {
    listener(readCompiledWiring(options, resolved))
  } catch (err) {
    console.warn('[theokit] onWired listener threw; the agent was still built:', err)
  }
}

interface AgentStatics {
  getOrCreate(id: string, options: never): Promise<unknown>
  get(id: string, options?: { cwd?: string }): Promise<unknown>
  registry?: { get(id: string): unknown }
}

interface SkillsHandle {
  list(): Promise<readonly { name?: unknown }[]>
}

/** Handles already reported, so racing callers that share one SDK creation report it once. */
const REPORTED = new WeakSet()

/** True when the SDK already holds this session: live in its cache, or persisted for a resume. */
async function sessionExists(
  statics: AgentStatics,
  sessionId: string,
  options: Record<string, unknown>,
): Promise<boolean> {
  if (statics.registry?.get(sessionId) !== undefined) return true
  try {
    const cwd = (options.local as { cwd?: string } | undefined)?.cwd
    await statics.get(sessionId, cwd !== undefined ? { cwd } : {})
    return true
  } catch (err) {
    if ((err as { name?: unknown } | null)?.name === 'UnknownAgentError') return false
    throw err
  }
}

/** The skills the created agent actually resolved; `undefined` when the handle exposes none. */
async function resolvedSkills(agent: unknown): Promise<string[] | undefined> {
  const handle = (agent as { skills?: SkillsHandle } | null)?.skills
  if (handle === undefined) return undefined
  try {
    return names(await handle.list())
  } catch (err) {
    console.warn('[theokit] could not list the resolved skills for onWired:', err)
    return undefined
  }
}

/**
 * `Agent.getOrCreate`, reporting the wiring only when this call CREATED the agent.
 *
 * The SDK's own `getOrCreate` always does the resolution, so its live-agent cache and in-flight
 * registry are preserved for every caller, with or without a listener. A session the SDK already
 * held (cached or persisted) is a resume, not a creation, and is not reported; handles are marked
 * so callers sharing one creation report it once.
 */
export async function getOrCreateReporting(
  sdk: unknown,
  sessionId: string,
  options: Record<string, unknown>,
  listener: ((wiring: CompiledWiring) => void) | undefined,
): Promise<unknown> {
  const statics = sdk as AgentStatics
  const existed = listener !== undefined && (await sessionExists(statics, sessionId, options))
  const agent = await statics.getOrCreate(sessionId, options as never)
  if (listener === undefined || existed) return agent
  if (typeof agent === 'object' && agent !== null) {
    if (REPORTED.has(agent)) return agent
    REPORTED.add(agent)
  }
  reportWiring(listener, options, await resolvedSkills(agent))
  return agent
}
