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
    /** Skills named in the options: enabled names plus inline skills. Skills the SDK discovers on disk are not enumerated. */
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
export function readCompiledWiring(options: Record<string, unknown>): CompiledWiring {
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
      // Enabled names resolve against the project root, which only a granted `project` source reads.
      listed: [
        ...new Set([...(sources.includes('project') ? names(skills?.enabled) : []), ...inline]),
      ],
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
export function reportWiring(
  listener: ((wiring: CompiledWiring) => void) | undefined,
  options: Record<string, unknown>,
): void {
  if (listener === undefined) return
  try {
    listener(readCompiledWiring(options))
  } catch (err) {
    console.warn('[theokit] onWired listener threw; the agent was still built:', err)
  }
}

interface AgentStatics {
  getOrCreate(id: string, options: never): Promise<unknown>
}

type BeforeCreate = (ctx: unknown) => unknown

/**
 * `Agent.getOrCreate`, reporting the wiring only when this call CREATED the agent.
 *
 * The SDK's own `getOrCreate` stays the single authority: it serves a live-cache hit, joins an
 * in-flight creation and registers the new handle in the live cache, so every caller of one id gets
 * the same handle and nothing here can create a second one. Creation is detected through the SDK's
 * `onBeforeCreate` gate, which runs only on the call that actually creates (after the id-collision
 * check, never on a cache hit, a join or a resume). The report is made once `getOrCreate` resolves,
 * so a creation that fails reports nothing and a retry reports normally.
 *
 * A caller that joins another call's creation, or hits the cache, gets no report: its options were
 * not the ones the agent was built with. A caller's own `onBeforeCreate` is kept and runs first.
 */
export async function getOrCreateReporting(
  sdk: unknown,
  sessionId: string,
  options: Record<string, unknown>,
  listener: ((wiring: CompiledWiring) => void) | undefined,
): Promise<unknown> {
  const statics = sdk as AgentStatics
  if (listener === undefined) return statics.getOrCreate(sessionId, options as never)
  const state = { created: false }
  const own = options.onBeforeCreate as BeforeCreate | undefined
  const gated = {
    ...options,
    onBeforeCreate: async (ctx: unknown) => {
      if (own !== undefined) await own(ctx)
      state.created = true
    },
  }
  const agent = await statics.getOrCreate(sessionId, gated as never)
  if (state.created) reportWiring(listener, options)
  return agent
}

interface Hold {
  /** Stream callers still using the handle; each releases exactly its own via `releaseSharedAgent`. */
  streams: number
  /** Served owners share ONE hold: they all hold the registry handle itself, so they are one owner. */
  served: boolean
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
 * `Agent.registry.get(id)`), whose `dispose()` is replaced by a release of the single served hold.
 * Repeated `dispose()` is a no-op, and never touches a stream's hold. Only the last hold disposes.
 */
export function acquireSharedAgent(
  sdk: unknown,
  sessionId: string,
  options: Record<string, unknown>,
  listener: ((wiring: CompiledWiring) => void) | undefined,
  kind: 'stream' | 'served' = 'stream',
): Promise<unknown> {
  return inLane(sdk as object, sessionId, async () => {
    const agent = (await getOrCreateReporting(sdk, sessionId, options, listener)) as object
    let hold = holders.get(agent)
    if (hold === undefined) {
      const target = agent as { dispose(): Promise<void> }
      hold = {
        streams: 0,
        served: false,
        sdk: sdk as object,
        id: sessionId,
        dispose: target.dispose.bind(target),
      }
      holders.set(agent, hold)
      // The handle's own `dispose()` (whoever calls it) can only drop the served hold.
      setDispose(agent, () => releaseServed(target))
    }
    if (kind === 'served') hold.served = true
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
  if (hold.streams > 0 || hold.served) return
  holders.delete(agent)
  // Back to the real disposal, so a later `dispose()` on this handle cannot loop through us.
  setDispose(agent, hold.dispose)
  await hold.dispose()
}

function releaseServed(agent: object): Promise<void> {
  const hold = holders.get(agent)
  if (hold === undefined) return Promise.resolve()
  return inLane(hold.sdk, hold.id, async () => {
    if (!hold.served) return
    hold.served = false
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
