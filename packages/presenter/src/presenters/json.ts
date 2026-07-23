import type { AgentOutputEvent } from '../agent-output-event.js'
import type { Presenter } from '../presenter.js'

/**
 * `JsonPresenter` (M51) — the API / programmatic surface: the canonical {@link AgentOutputEvent} → a
 * stable, machine-readable JSON record. Third peer of the web (`UIMessageStreamPresenter`) and terminal
 * (`TerminalPresenter`) surfaces, proving the contract generalizes: ONE canonical event, N surfaces.
 *
 * Consumers (a `--json` CLI, a webhook, a log sink) read FIELDS, never regex over rendered UI strings.
 * The record keeps the canonical discriminant under `type` and is namespaced with `agent.` so it can be
 * multiplexed onto a shared JSONL stream without colliding with a host's own event names.
 *
 * @public
 */
export interface JsonRecord {
  /** Namespaced canonical discriminant, e.g. `agent.text` / `agent.tool-call`. */
  readonly type: string
  readonly [key: string]: unknown
}

export interface JsonPresenterOptions {
  /** Prefix for the `type` field (default `"agent."`). Pass `""` for bare discriminants. */
  readonly namespace?: string
}

export class JsonPresenter implements Presenter<JsonRecord> {
  readonly surface = 'json'
  readonly #ns: string

  constructor(options: JsonPresenterOptions = {}) {
    this.#ns = options.namespace ?? 'agent.'
  }

  present(event: AgentOutputEvent): JsonRecord[] {
    // The canonical event IS already a flat, typed record — the JSON surface only namespaces the
    // discriminant and passes the payload through verbatim (no lossy re-shaping).
    const { type, ...payload } = event
    return [{ type: `${this.#ns}${type}`, ...payload }]
  }
}
