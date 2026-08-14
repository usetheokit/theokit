import { TheokitAgentError } from '@theokit/sdk/errors'

import type { Capability, CompiledAgentOptionsDraft } from './capability.js'

/**
 * M52 — resolution + composition. The registry is what unlocks FILE-BASED authoring (a config lists
 * capability names): resolving name → capability without a switch that grows per feature (OCP).
 */

/** Fail-fast with the known set — never `undefined` leaking into the pipeline. */
/**
 * M80 — extends {@link TheokitAgentError}, not plain `Error`.
 *
 * `isTransientError` is defined over `TheokitAgentError`, so a class outside that hierarchy is
 * INVISIBLE to it and the only recourse left to a consumer is matching on message text. `code` is
 * stable across a rename; `isRetryable` is DECLARED, because a default would be a retry policy
 * nobody chose.
 */
export class UnknownCapabilityError extends TheokitAgentError {
  override readonly name = 'UnknownCapabilityError'
  constructor(requested: string, known: readonly string[]) {
    super(`capability "${requested}" is not registered. Known: ${known.join(', ') || '(none)'}.`, {
      code: 'UNKNOWN_CAPABILITY',
      // A name that is not in the registry will not be in it on the next attempt either.
      isRetryable: false,
    })
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
