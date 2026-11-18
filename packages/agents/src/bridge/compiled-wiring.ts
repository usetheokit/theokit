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
    /** Skills the created agent resolved (`agent.skills.list()`), discovered on disk or inline; the inline names alone when the SDK exposes no list. */
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

/**
 * Read the wiring from the options exactly as they reach `Agent.create`.
 *
 * `resolvedSkills` is what the created agent itself lists (`agent.skills.list()`): the SDK decides
 * which skills exist after discovery, the settings gate and `skills.enabled`, so the options alone
 * cannot say. Without it only the inline skills named in the options are known.
 */
export function readCompiledWiring(
  options: Record<string, unknown>,
  resolvedSkills?: readonly string[],
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
      listed: [...new Set(resolvedSkills ?? inline)],
      readable: reader !== undefined ? inline : [],
    },
    mcpServers: Object.keys((options.mcpServers as object | undefined) ?? {}),
    hooks: hooksOf(options.plugins),
    subagents: Object.keys((options.agents as object | undefined) ?? {}),
    settingSources: { project: sources.includes('project'), user: sources.includes('user') },
    withheldBuiltinTools: [...withheld],
  }
}

/** Report the wiring; a throwing listener is warned about and never fails the build. */
export async function reportWiring(
  listener: ((wiring: CompiledWiring) => void) | undefined,
  options: Record<string, unknown>,
  agent?: unknown,
): Promise<void> {
  if (listener === undefined) return
  try {
    listener(readCompiledWiring(options, await resolvedSkillNames(agent)))
  } catch (err) {
    console.warn('[theokit] onWired listener threw; the agent was still built:', err)
  }
}

/** The skills the SDK resolved for this agent, or `undefined` when it exposes none to ask. */
async function resolvedSkillNames(agent: unknown): Promise<string[] | undefined> {
  const handle = (
    agent as { skills?: { list?: () => Promise<readonly { name: string }[]> } } | null
  )?.skills
  if (typeof handle?.list !== 'function') return undefined
  try {
    return (await handle.list()).map((s) => s.name)
  } catch (err) {
    console.warn('[theokit] could not list the agent skills for onWired:', err)
    return undefined
  }
}

interface AgentStatics {
  getOrCreate(id: string, options: never): Promise<unknown>
  create?(options: never): Promise<unknown>
}

/** Carried on the options of one call; fired when THAT call's options reach a successful `Agent.create`. */
const CREATED: unique symbol = Symbol.for('theokit.agents.onCreated')

const observed = new WeakSet()

/**
 * Make `create` report which call's options it was given, passing every other call straight
 * through. The SDK's `getOrCreate` creates through `Agent.create`, so this is the one signal that
 * says whose options built the agent, even when a direct SDK call won the creation.
 */
function observeCreate(statics: AgentStatics): void {
  if (observed.has(statics) || typeof statics.create !== 'function') return
  observed.add(statics)
  // eslint-disable-next-line @typescript-eslint/unbound-method -- re-invoked with the caller's `this` below
  const original = statics.create
  statics.create = async function (this: unknown, opts: never) {
    const agent = await original.call(this, opts)
    ;(opts as Record<symbol, (() => void) | undefined>)[CREATED]?.()
    return agent
  }
}

const inFlight = new WeakMap<object, Map<string, Promise<unknown>>>()

/**
 * `Agent.getOrCreate`, reporting the wiring only when THIS call's options created the agent.
 *
 * Creation, caching and disposal stay entirely inside the SDK's own `getOrCreate` (its in-flight
 * map, live registry and race handling), so a listener call and any direct SDK call for one
 * session converge on a single live, registered handle and nothing is disposed or replaced here.
 * The creator is identified by a marker on this call's options that `Agent.create` hands back, so
 * a call that resumes, hits the live cache, or joins another caller's in-flight creation reports
 * nothing, and the wiring reported is always that of the options that built the agent.
 */
export function getOrCreateReporting(
  sdk: unknown,
  sessionId: string,
  options: Record<string, unknown>,
  listener: ((wiring: CompiledWiring) => void) | undefined,
): Promise<unknown> {
  const statics = sdk as AgentStatics
  if (listener === undefined) return statics.getOrCreate(sessionId, options as never)
  const key = sdk as object
  const pending = inFlight.get(key) ?? new Map<string, Promise<unknown>>()
  inFlight.set(key, pending)
  const running = pending.get(sessionId)
  if (running) return running
  observeCreate(statics)
  const p = (async () => {
    const state = { created: false }
    const marked = { ...options, [CREATED]: () => (state.created = true) }
    const agent = await statics.getOrCreate(sessionId, marked as never)
    if (state.created) await reportWiring(listener, options, agent)
    return agent
  })().finally(() => pending.delete(sessionId))
  pending.set(sessionId, p)
  return p
}
