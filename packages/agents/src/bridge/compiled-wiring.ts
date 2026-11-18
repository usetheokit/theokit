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
    tools: names(tools).filter((n) => !withheld.includes(n)),
    skills: {
      listed: [...new Set([...names(skills?.enabled), ...inline])],
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

/** Agents already reported: `Agent.getOrCreate` hands back the live agent for a known session. */
const REPORTED_AGENTS = new WeakSet()

/**
 * Report the wiring only when `getOrCreate` actually created the agent. A reused agent (resumed
 * session) keeps the wiring it was built with, which was already reported, so the options of this
 * call, which the SDK ignored, are not reported again.
 */
export function reportWiringIfCreated(
  listener: ((wiring: CompiledWiring) => void) | undefined,
  options: Record<string, unknown>,
  agent: unknown,
): void {
  if (typeof agent !== 'object' || agent === null) {
    reportWiring(listener, options)
    return
  }
  if (REPORTED_AGENTS.has(agent)) return
  REPORTED_AGENTS.add(agent)
  reportWiring(listener, options)
}
