import type { AgentOutputEvent } from './agent-output-event.js'

/**
 * `Presenter<TOut>` — the Strategy that turns the canonical {@link AgentOutputEvent} into ONE surface's
 * output (M49). Web (`UIMessageStream`), terminal (ANSI), and JSON API are peer implementations; each
 * consumes the SAME canonical event, so a source is translated once and every surface reuses it.
 *
 * The contract is **per-event, driven by the caller**: the host loops the event stream and calls
 * `present(event)` for each, so it can INTERLEAVE a presenter's pure-output chunks with framework chunks
 * (HITL approval, checkpoints, done-metadata — `@theokit/agents`) in true model order (ADR-4). Optional
 * `start()` / `finish()` bracket the stream for stateful surfaces (the web stream's `start` framing and
 * its open-block close + `finish`). A stateful presenter (web) holds its open-block state internally and
 * is therefore instantiated **per stream**; stateless presenters (terminal/json) may be singletons.
 *
 * @public
 */
export interface Presenter<TOut> {
  /** Stable surface key (`"ui-message-stream" | "terminal" | "json" | …`) — the registry resolves by it. */
  readonly surface: string
  /** Optional opening framing emitted once before any event (e.g. the web stream's `{ type: 'start' }`). */
  start?(): TOut[]
  /** Translate one canonical event into zero or more surface chunks (may maintain internal stream state). */
  present(event: AgentOutputEvent): TOut[]
  /** Optional closing framing emitted once after the last event (e.g. close the open block + `finish`). */
  finish?(): TOut[]
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
