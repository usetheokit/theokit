import type { AgentOutputEvent } from './agent-output-event.js'

/**
 * `Presenter<TOut>` — the Strategy that turns the canonical {@link AgentOutputEvent} into ONE surface's
 * output (M49). Web (`UIMessageStream`), terminal (ANSI), and JSON API are peer implementations; each
 * consumes the SAME canonical event, so a source is translated once and every surface reuses it.
 *
 * A presenter is **per-event and pure**: `present(event)` returns zero or more output chunks. Statefulness
 * (e.g. a web stream's start/finish framing) is the presenter's own concern, kept behind this contract.
 *
 * @public
 */
export interface Presenter<TOut> {
  /** Stable surface key (`"ui-message-stream" | "terminal" | "json" | …`) — the registry resolves by it. */
  readonly surface: string
  /** Translate one canonical event into zero or more surface chunks. */
  present(event: AgentOutputEvent): TOut[]
}

/** Thrown when a surface key is resolved but no presenter is registered for it (fail-fast, typed). */
export class UnknownPresenterError extends Error {
  override readonly name = 'UnknownPresenterError'
  constructor(surface: string, known: readonly string[]) {
    super(
      `No presenter registered for surface "${surface}". Known: ${known.join(', ') || '(none)'}.`,
    )
  }
}

/**
 * A registry of presenters keyed by surface. Lets a single agent run be driven through any registered
 * surface without the caller hard-wiring a concrete presenter (Open/Closed — add a surface by registering,
 * not by editing a switch).
 *
 * @public
 */
export class PresenterRegistry {
  readonly #presenters = new Map<string, Presenter<unknown>>()

  /** Register (or replace) the presenter for its surface. Returns `this` for fluent wiring. */
  register(presenter: Presenter<unknown>): this {
    this.#presenters.set(presenter.surface, presenter)
    return this
  }

  /** Whether a presenter is registered for `surface`. */
  has(surface: string): boolean {
    return this.#presenters.has(surface)
  }

  /** The registered surface keys. */
  surfaces(): string[] {
    return [...this.#presenters.keys()]
  }

  /** Resolve the presenter for `surface`, or throw {@link UnknownPresenterError} (never returns undefined). */
  resolve<TOut>(surface: string): Presenter<TOut> {
    const p = this.#presenters.get(surface)
    if (p === undefined) throw new UnknownPresenterError(surface, this.surfaces())
    return p as Presenter<TOut>
  }
}
