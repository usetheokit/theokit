/**
 * The compiled wiring of an agent: what was handed to `Agent.create`, read back from those options.
 *
 * Derived from the FINAL options object, never from a second read of the inputs, so a status panel
 * cannot disagree with the build.
 */

/** What an agent was built with, as reported to `onWired`. */
export interface CompiledWiring {
  /** Caller-supplied tool names handed to `Agent.create`; withheld builtins are listed in `withheldBuiltinTools`, and a caller tool sharing a withheld name stays here. SDK defaults are not enumerated. */
  readonly tools: readonly string[]
  readonly skills: {
    /** Skills the created agent resolved (`agent.skills.list()`): a disk skill appears only when its source is granted and it exists; an inline skill only when also named in `skills.enabled`. */
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
export const BUILD_WIRED_SKILL_READERS = new WeakMap<object, 'inline' | 'advertised'>()

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

/** Skills a `skill_read` wired by this build serves; a caller-supplied reader reports none. */
function readableSkills(tools: object[], listed: string[], skills: Loose): string[] {
  for (const t of tools) {
    if ((t as { name?: unknown }).name !== 'skill_read') continue
    // eslint-disable-next-line sonarjs/no-empty-collection -- populated by advertised-skill-read.ts
    const mode = BUILD_WIRED_SKILL_READERS.get(t)
    if (mode === 'advertised') return listed
    if (mode === 'inline') return names(skills?.inline)
  }
  return []
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
  const readable = readableSkills(tools, listed, skills)
  const sources = ((options.local as Loose)?.settingSources as string[] | undefined) ?? []
  return {
    // Caller-supplied tools only: a custom tool may deliberately replace a withheld builtin.
    tools: names(tools),
    skills: {
      listed,
      readable,
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

interface Hold {
  /** Stream callers still using the handle; each releases exactly its own via `releaseSharedAgent`. */
  streams: number
  /** Served holders, oldest first: each `dispose()` of the shared handle releases the oldest. */
  served: (() => void)[]
  sdk: object
  id: string
  dispose: () => Promise<void>
}

const holders = new WeakMap<object, Hold>()
const lanes = new WeakMap<object, Map<string, Promise<unknown>>>()

/** Run `fn` after every earlier acquire/release of this session on this SDK has settled. */
function inLane<T>(sdk: object, id: string, fn: () => Promise<T>): Promise<T> {
  const lane = lanes.get(sdk) ?? new Map<string, Promise<unknown>>()
  lanes.set(sdk, lane)
  const run = (lane.get(id) ?? Promise.resolve()).then(fn)
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  lane.set(id, tail)
  void tail.then(() => {
    if (lane.get(id) === tail) lane.delete(id)
  })
  return run
}

/**
 * Callers for one session share the SDK's cached handle, and `dispose()` evicts it from the live
 * cache. Resolving and holding happen in one lane with releasing, so a handle obtained here can
 * never be disposed by another caller's last release before this caller holds it.
 *
 * `kind: 'stream'` (default): the caller releases with {@link releaseSharedAgent}; holds are counted.
 * `kind: 'served'`: the caller keeps the SDK's own handle (identity preserved, same object as
 * `Agent.registry.get(id)`), whose `dispose()` is replaced by a release of ONE served hold. The
 * handle is one object, so a `dispose()` cannot name its caller: it releases the oldest hold and
 * runs that hold's `onRelease`. Calls beyond the held count are no-ops, and none touches a stream's
 * hold. Only the last hold disposes.
 */
export function acquireSharedAgent(
  sdk: unknown,
  sessionId: string,
  options: Record<string, unknown>,
  kind: 'stream' | 'served' = 'stream',
  onRelease: () => void = () => undefined,
): Promise<unknown> {
  return inLane(sdk as object, sessionId, async () => {
    const agent = (await getOrCreateReporting(sdk, sessionId, options)) as object
    let hold = holders.get(agent)
    if (hold === undefined) {
      const target = agent as { dispose(): Promise<void> }
      hold = {
        streams: 0,
        served: [],
        sdk: sdk as object,
        id: sessionId,
        dispose: target.dispose.bind(target),
      }
      holders.set(agent, hold)
      // The handle's own `dispose()` (whoever calls it) can only drop a served hold.
      setDispose(agent, () => releaseServed(target))
    }
    if (kind === 'served') hold.served.push(onRelease)
    else hold.streams++
    return agent
  })
}

function setDispose(agent: object, value: () => Promise<void>): void {
  Object.defineProperty(agent, 'dispose', {
    value,
    configurable: true,
    writable: true,
    enumerable: false,
  })
}

async function settle(agent: object, hold: Hold): Promise<void> {
  if (hold.streams > 0 || hold.served.length > 0) return
  holders.delete(agent)
  // Back to the real disposal, so a later `dispose()` on this handle cannot loop through us.
  setDispose(agent, hold.dispose)
  await hold.dispose()
}

function releaseServed(agent: object): Promise<void> {
  const hold = holders.get(agent)
  if (hold === undefined) return Promise.resolve()
  return inLane(hold.sdk, hold.id, async () => {
    hold.served.shift()?.()
    await settle(agent, hold)
  })
}

/** Drop one stream hold; dispose the agent only when no other caller still holds it. */
export function releaseSharedAgent(agent: { dispose(): Promise<void> }): Promise<void> {
  const hold = holders.get(agent)
  if (hold === undefined) return agent.dispose()
  return inLane(hold.sdk, hold.id, async () => {
    if (hold.streams > 0) hold.streams--
    await settle(agent, hold)
  })
}
