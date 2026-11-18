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
      // Enabled names resolve from on-disk skill roots, which only a granted `project` or `user` source reads.
      listed: [
        ...new Set([
          ...(sources.includes('project') || sources.includes('user')
            ? names(skills?.enabled)
            : []),
          ...inline,
        ]),
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
  resume(id: string, options: never): Promise<unknown>
  create(options: never): Promise<unknown>
}

const isErr = (err: unknown, key: 'name' | 'code', value: string): boolean =>
  (err as Record<string, unknown> | null)?.[key] === value

/**
 * `Agent.getOrCreate`, reporting the wiring only when this call CREATED the agent.
 *
 * With a listener it follows the SDK's documented resolution itself, because the creation event is
 * the only reliable signal: resume; on `UnknownAgentError` create; if a concurrent creator won
 * (`agent_id_already_exists`) resume the winner, which is not a creation of ours. Resume gets the
 * final options, so a non-default `cwd` is honoured. Without a listener it is plain `getOrCreate`.
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
  let pending = inFlight.get(sdk as object)
  if (!pending) inFlight.set(sdk as object, (pending = new Map()))
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
  try {
    return await statics.resume(sessionId, options as never)
  } catch (err) {
    if (!isErr(err, 'name', 'UnknownAgentError')) throw err
  }
  let agent: unknown
  try {
    agent = await statics.create({ ...options, agentId: sessionId } as never)
  } catch (err) {
    if (!isErr(err, 'code', 'agent_id_already_exists')) throw err
    return statics.resume(sessionId, options as never)
  }
  reportWiring(listener, options)
  return agent
}
