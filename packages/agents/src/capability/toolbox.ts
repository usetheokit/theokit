import {
  compileHitlGates,
  compileTools,
  toolRuntimeName,
  type ClassToken,
  type CompiledTool,
  type ToolboxWalkResult,
} from '../bridge/agent-compiler.js'
import type { ApprovalOptions, HumanInTheLoopOptions, ToolOptions } from '../types.js'

import { ConfigurationError } from './capabilities.js'
import type { Capability, CompiledAgentOptionsDraft } from './capability.js'

/**
 * M53 — tools without `@Toolbox`/`@Tool`.
 *
 * A toolbox class declares its tools as DATA (`static tools`) and keeps its handlers as ordinary
 * methods; the capability takes an INSTANCE. That preserves what the decorators actually bought —
 * grouping under a namespace and handlers bound to the instance (so a toolbox can hold state and
 * injected dependencies) — with no metadata reflection at all.
 *
 * The compilation itself is NOT reimplemented: it delegates to `compileTools`, the same function the
 * decorator path calls, so namespacing (`toolRuntimeName`), handler binding and the fail-fast checks
 * stay in one place.
 *
 * @example
 * ```ts
 * class SupportTools {
 *   static tools: ToolDeclaration[] = [
 *     { name: 'search', description: 'Search tickets', input: z.object({ q: z.string() }), method: 'search' },
 *   ]
 *   async search({ q }: { q: string }): Promise<string> { return `found ${q}` }
 * }
 *
 * const agent = applyCapabilities([
 *   new ModelCapability('openai/gpt-5.4'),
 *   new ToolboxCapability(new SupportTools(), { namespace: 'support' }),
 * ])
 * ```
 */
export interface ToolDeclaration extends ToolOptions {
  /** Method on the toolbox instance that implements this tool. */
  readonly method: string
  /** Require human approval before the tool runs (surfaced in the manifest). */
  readonly approval?: ApprovalOptions
  /** Gate the tool behind human-in-the-loop (M4). */
  readonly hitl?: HumanInTheLoopOptions
  /** Manifest-only observability flags. */
  readonly trace?: boolean
  readonly audit?: boolean
}

/** A toolbox instance whose class declares its tools. */
export interface ToolboxSource {
  readonly constructor: { tools?: readonly ToolDeclaration[] }
}

export interface ToolboxOptions {
  /**
   * Prefix for every tool name (`"<namespace>_<tool>"`), as `@Toolbox({ namespace })` did.
   * The separator is `_`, not `.` — the dot is outside the charset the SDK accepts (theokit#145).
   */
  readonly namespace?: string
  /** Declarations, when they are not on the class as `static tools`. */
  readonly tools?: readonly ToolDeclaration[]
}

export class ToolboxCapability implements Capability {
  readonly name = 'toolbox'
  readonly #instance: object
  readonly #declarations: readonly ToolDeclaration[]
  readonly #namespace: string

  constructor(instance: object, options: ToolboxOptions = {}) {
    // Boundary check: the registry hands this `unknown` straight from a config file, so the guard is
    // real at runtime even though the declared type makes it look redundant to the compiler.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- may not be an object at runtime
    if (typeof instance !== 'object' || instance === null) {
      throw new ConfigurationError('toolbox: esperava uma instância de toolbox')
    }
    const declared =
      options.tools ?? (instance.constructor as { tools?: readonly ToolDeclaration[] }).tools
    if (declared === undefined || declared.length === 0) {
      throw new ConfigurationError(
        `toolbox: ${instance.constructor.name} não declara tools — use \`static tools = [...]\` ou a opção \`tools\``,
      )
    }
    for (const tool of declared) {
      // Validate here rather than at call time: a missing method only surfaces when the model
      // decides to call the tool, which is the worst moment to discover a typo.
      if (typeof (instance as Record<string, unknown>)[tool.method] !== 'function') {
        throw new ConfigurationError(
          `toolbox: ${instance.constructor.name}.${tool.method} não é um método (tool "${tool.name}")`,
        )
      }
    }
    this.#instance = instance
    this.#declarations = declared
    this.#namespace = options.namespace ?? ''
    // Fail at AUTHORING, not when the model finally calls the tool: a namespace/tool pair that
    // cannot mint a name the SDK accepts is a broken agent, and `Agent.create` would only say so
    // at runtime (theokit#145).
    //
    // The CALL is the validation (M55): `toolRuntimeName` validates what it mints, so this loop no
    // longer knows the name format — one module owns that rule. Re-testing it here would be the
    // very duplication that let the gate key and the tool name drift apart in #145. The minted
    // value is intentionally discarded; `compile()` mints again when it actually needs it.
    for (const tool of declared) toolRuntimeName(this.#namespace, tool.name)
  }

  /**
   * The single derivation of this toolbox (M55). Both compilers below consume THIS object, so the
   * tool registry and the HITL gate map cannot disagree on a name — the property is structural, not
   * a convention repeated in two loops. That repetition is precisely how the two drifted apart in
   * #145: the tool became `ns_tool` while its gate stayed `ns.tool`, silently ungating it.
   *
   * Same technique the `opencode` harness uses for the analogous tool↔permission coupling, where
   * `Permission.visibleTools` filters the tool record itself rather than keeping a parallel map
   * ("so the two cannot drift" — `permission/index.ts`).
   */
  #walk(): ToolboxWalkResult {
    return {
      // `constructor` is typed `Function` by lib.d.ts; here it is used purely as an IDENTITY key
      // into the instances map, which is what `ClassToken` models.
      class: this.#instance.constructor as ClassToken,
      namespace: this.#namespace,
      guards: [],
      tools: this.#declarations.map((tool) => ({
        propertyKey: tool.method,
        config: tool,
        guards: [],
        approval: tool.approval,
        trace: tool.trace ?? false,
        audit: tool.audit ?? false,
        ...(tool.hitl !== undefined ? { hitl: tool.hitl } : {}),
      })),
    }
  }

  /** The compiled tools this toolbox contributes — the same shape the decorator path produces. */
  compile(): CompiledTool[] {
    const walk = this.#walk()
    return compileTools([walk], new Map([[walk.class, this.#instance]]))
  }

  apply(draft: CompiledAgentOptionsDraft): void {
    const walk = this.#walk()

    // ACCUMULATES: several toolboxes compose into one agent, exactly as several `@Toolbox` classes did.
    draft.tools.push(...compileTools([walk], new Map([[walk.class, this.#instance]])))
    draft.provenance.push({ capability: this.name, contributed: ['tools'] })

    const gates = compileHitlGates([walk])
    // The early return comes BEFORE `??=`, deliberately: `agent-compiler.ts` documents that an
    // empty gate map means "no gated tools ⇒ the non-HITL stream path (M2, byte-unchanged)".
    // Creating an empty Map here would flip that branch for every agent that has no HITL at all.
    if (gates.size === 0) return
    draft.hitl ??= new Map()
    for (const [key, options] of gates) draft.hitl.set(key, options)
    draft.provenance.push({ capability: this.name, contributed: ['hitl'] })
  }
}
