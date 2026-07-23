import type { Capability, CompiledAgentOptionsDraft } from './capability.js'

/**
 * M52 — resolution + composition. The registry is what unlocks FILE-BASED authoring (a config lists
 * capability names): resolving name → capability without a switch that grows per feature (OCP).
 */

/** Fail-fast with the known set — never `undefined` leaking into the pipeline. */
export class UnknownCapabilityError extends Error {
  override readonly name = 'UnknownCapabilityError'
  constructor(requested: string, known: readonly string[]) {
    super(
      `capability "${requested}" não registrada. Conhecidas: ${known.join(', ') || '(nenhuma)'}.`,
    )
  }
}

/** **Registry + Factory Method.** */
export class CapabilityRegistry {
  readonly #factories = new Map<string, (arg: unknown) => Capability>()

  register(name: string, factory: (arg: unknown) => Capability): this {
    this.#factories.set(name, factory)
    return this
  }

  has(name: string): boolean {
    return this.#factories.has(name)
  }

  names(): string[] {
    return [...this.#factories.keys()]
  }

  resolve(name: string, arg?: unknown): Capability {
    const factory = this.#factories.get(name)
    if (factory === undefined) throw new UnknownCapabilityError(name, this.names())
    return factory(arg)
  }
}

/**
 * **Composite** — a preset behaves like ONE capability, so a caller says `codingAgent()` instead of
 * spreading an array at the call site. Members apply in declaration order (deterministic).
 */
export class CapabilityPreset implements Capability {
  readonly #members: readonly Capability[]
  constructor(
    readonly name: string,
    members: readonly Capability[],
  ) {
    this.#members = members
  }
  apply(draft: CompiledAgentOptionsDraft): void {
    for (const member of this.#members) member.apply(draft)
  }
}
