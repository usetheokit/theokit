import { TheokitAgentError } from '@theokit/sdk/errors'
/**
 * M91 — `Toolset`: a named, immutable collection of tools, with a resolution policy that fails loud.
 *
 * ## Why in the layer
 *
 * The layer already publishes the `sandbox` and `interactive` seams; this is the counterpart that was
 * missing. Without it the consumer wrote its own — agent-builder's `agents/tools/registry.ts`, 170
 * LoC — and the policy that matters (failing loud on an unknown name **and** on a duplicate) stayed
 * outside the framework, where the next consumer would have to rediscover it.
 *
 * ## What it does NOT do, and why
 *
 * **It does not prefix a namespace.** That is what disqualified `ToolboxCapability` from this same
 * directory for this role: a tool's name is a **contract with the model**, and prefixing changes what
 * the model sees.
 *
 * **It does not build tools.** Which tools, with which options and under which scope is the
 * consumer's decision — the layer knows nobody's `projectRoot` and nobody's sandbox posture. The
 * `Toolset` receives entries already built and owns only the **resolution policy**. That split is
 * what stops the primitive from becoming a second copy of the consumer's registry.
 *
 * ## Why fail loud in both cases
 *
 * An **unknown** name: a role that declares `run_shell` in a whitelist and gets silence ends up
 * without the tool and nobody notices. A **duplicate** name: registers the same tool twice in
 * `Agent.create`, with no signal at all. In both, the result is an **unobservable** change of
 * authority — which is exactly what a whitelist exists to prevent.
 */

/** The minimum `Toolset` needs to know about a tool: that it has a name. */
export interface NamedTool {
  readonly name: string
}

/**
 * @deprecated Renamed to `NamedTool`. This alias exists so a consumer pinned to the previous minor
 * keeps compiling; it will be removed in the next major.
 */
// The alias IS the migration path: redundant on purpose, so a consumer pinned to the previous minor
// keeps compiling. Sunset: the next major, where it is deleted along with this comment.
export type ToolComNome = NamedTool

/**
 * U-3 — inside the SDK hierarchy, not beside it.
 *
 * It extended `Error` directly, so `catch (e instanceof TheokitAgentError)` — how consumers tell an
 * SDK failure from any other throw — missed it, leaving name or message matching as the only way to
 * recognise it. A consumer reported having to write a translateError() shim for exactly that.
 *
 * This layer already settled the same argument in M61, when two `ConfigurationError` classes (one
 * `extends Error`, one `extends TheokitAgentError`) made an `instanceof` catch one path and silently
 * miss the other. Same defect, same package; it was simply left standing here.
 *
 * `code` stays a public readonly field rather than moving into the base options, so every existing
 * `new ToolsetError(msg, 'unknown_tool')` and every `err.code` read is unchanged.
 */
export class ToolsetError extends TheokitAgentError {
  override readonly name = 'ToolsetError'

  constructor(
    message: string,
    readonly code: 'unknown_tool' | 'duplicate_tool',
  ) {
    super(message)
  }
}

export class Toolset<T extends NamedTool> {
  readonly #byName: ReadonlyMap<string, T>

  private constructor(byName: ReadonlyMap<string, T>) {
    this.#byName = byName
    Object.freeze(this)
  }

  /**
   * Builds from tools that are already instantiated. Fails loud on a duplicate name **at construction**
   * — not at resolution: a descriptor with two tools of the same name is wrong the moment it is
   * written, and deferring the error to the first `resolve` hides half the cases.
   */
  static from<T extends NamedTool>(tools: readonly T[]): Toolset<T> {
    const byName = new Map<string, T>()
    for (const tool of tools) {
      if (byName.has(tool.name)) {
        throw new ToolsetError(`duplicate tool "${tool.name}" in toolset`, 'duplicate_tool')
      }
      byName.set(tool.name, tool)
    }
    return new Toolset(byName)
  }

  /** One tool by name. Throws with the name in the error — never returns `undefined` silently. */
  get(name: string): T {
    const tool = this.#byName.get(name)
    if (tool === undefined) {
      throw new ToolsetError(`unknown tool "${name}"`, 'unknown_tool')
    }
    return tool
  }

  /**
   * Resolves a whitelist. Fails loud on an unknown name **and** on a duplicate within the list itself:
   * a team never silently grants a tool the role did not declare, nor silently drops one it did.
   */
  resolve(names: readonly string[]): readonly T[] {
    const seen = new Set<string>()
    return names.map((name) => {
      if (seen.has(name)) {
        throw new ToolsetError(`duplicate tool "${name}" in a whitelist`, 'duplicate_tool')
      }
      seen.add(name)
      return this.get(name)
    })
  }

  /** The known names, in registration order. */
  names(): readonly string[] {
    return [...this.#byName.keys()]
  }

  /** All the tools, in registration order. */
  all(): readonly T[] {
    return [...this.#byName.values()]
  }
}
