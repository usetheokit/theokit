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
  /** The SDK's live-agent cache; `getOrCreate` answers from it before it resumes or creates. */
  registry?: { get(id: string): unknown; set(id: string, agent: never): void }
  getOrCreate(id: string, options: never): Promise<unknown>
  resume(id: string, options: never): Promise<unknown>
  create(options: never): Promise<unknown>
}

const isErr = (err: unknown, key: 'name' | 'code', value: string): boolean =>
  (err as Record<string, unknown> | null)?.[key] === value

/**
 * `Agent.getOrCreate`, reporting the wiring only when this call CREATED the agent.
 *
 * With a listener it follows the SDK's own resolution itself, because the creation event is the
 * only reliable signal: a live cached agent is returned untouched (a resume would rehydrate a
 * second handle and merge the new options into it); otherwise resume; on `UnknownAgentError`
 * create; if a concurrent creator won (`agent_id_already_exists`) resume the winner, which is not a
 * creation of ours. Whatever it resolves is put in the live cache, as `getOrCreate` does. Resume
 * gets the final options, so a non-default `cwd` is honoured. Without a listener it is plain
 * `getOrCreate`.
 */
const inFlight = new WeakMap<object, Map<string, Promise<unknown>>>()

/** Concurrent calls for one session share a single resolution, so the wiring is reported once. */
export function getOrCreateReporting(
  sdk: unknown,
  sessionId: string,
  options: Record<string, unknown>,
  listener: ((wiring: CompiledWiring) => void) | undefined,
): Promise<unknown> {
  if (listener === undefined) return resolveReporting(sdk, sessionId, options, listener)
  const key = sdk as object
  const pending = inFlight.get(key) ?? new Map<string, Promise<unknown>>()
  inFlight.set(key, pending)
  const running = pending.get(sessionId)
  if (running) return running
  const p = resolveReporting(sdk, sessionId, options, listener).finally(() =>
    pending.delete(sessionId),
  )
  pending.set(sessionId, p)
  return p
}

async function resolveReporting(
  sdk: unknown,
  sessionId: string,
  options: Record<string, unknown>,
  listener: ((wiring: CompiledWiring) => void) | undefined,
): Promise<unknown> {
  const statics = sdk as AgentStatics
  if (listener === undefined) return statics.getOrCreate(sessionId, options as never)
  const cached = statics.registry?.get(sessionId)
  if (cached !== undefined) return cached
  // `registry.set` disposes whatever it replaces, so never overwrite: if the SDK's own
  // `getOrCreate` cached a handle while this call was resolving, that handle wins and ours, which
  // would be a second live copy of the same session, is released.
  const remember = async (agent: unknown): Promise<unknown> => {
    const winner = statics.registry?.get(sessionId)
    if (winner === undefined) {
      statics.registry?.set(sessionId, agent as never)
      return agent
    }
    if (winner !== agent) {
      try {
        await (agent as { dispose?: () => Promise<void> | void } | null)?.dispose?.()
      } catch (err) {
        console.warn('[theokit] could not release a duplicate agent handle:', err)
      }
    }
    return winner
  }
  try {
    return await remember(await statics.resume(sessionId, options as never))
  } catch (err) {
    if (!isErr(err, 'name', 'UnknownAgentError')) throw err
  }
  let agent: unknown
  try {
    agent = await statics.create({ ...options, agentId: sessionId } as never)
  } catch (err) {
    if (!isErr(err, 'code', 'agent_id_already_exists')) throw err
    return remember(await statics.resume(sessionId, options as never))
  }
  // The agent was created by this call, so its wiring is reported even if a racer's handle wins.
  await reportWiring(listener, options, agent)
  return remember(agent)
}
