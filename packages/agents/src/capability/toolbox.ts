import {
  compileTools,
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
  /** Prefix for every tool name (`"<namespace>.<tool>"`), as `@Toolbox({ namespace })` did. */
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
  }

  /** The compiled tools this toolbox contributes — the same shape the decorator path produces. */
  compile(): CompiledTool[] {
    const walk: ToolboxWalkResult = {
      class: this.#instance.constructor,
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
    return compileTools([walk], new Map([[this.#instance.constructor, this.#instance]]))
  }

  apply(draft: CompiledAgentOptionsDraft): void {
    // ACCUMULATES: several toolboxes compose into one agent, exactly as several `@Toolbox` classes did.
    draft.tools.push(...this.compile())
    draft.provenance.push({ capability: this.name, contributed: ['tools'] })

    // `hitl` is keyed `"<namespace>.<tool>"` — the same key `compileHitlGates` builds. Collecting
    // the pairs first keeps `hitl` narrowed by the guard, with no assertion.
    const gates: [string, HumanInTheLoopOptions][] = []
    for (const tool of this.#declarations) {
      if (tool.hitl === undefined) continue
      gates.push([
        this.#namespace === '' ? tool.name : `${this.#namespace}.${tool.name}`,
        tool.hitl,
      ])
    }
    if (gates.length === 0) return
    draft.hitl ??= new Map()
    for (const [key, options] of gates) draft.hitl.set(key, options)
    draft.provenance.push({ capability: this.name, contributed: ['hitl'] })
  }
}
