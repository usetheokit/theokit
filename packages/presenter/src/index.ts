/**
 * `@theokit/presenter` — TheoKit's presentation layer (M49).
 *
 * The canonical {@link AgentOutputEvent} (the narrow waist) + the {@link Presenter} Strategy contract +
 * registry + the single SDK source translator. Sources translate INTO the canonical event; presenters
 * (web / terminal / json) translate OUT of it — agent output is normalized once and every surface reuses it.
 *
 * @packageDocumentation
 */
export * from './agent-output-event.js'
export * from './presenter.js'
export * from './source/from-sdk.js'
// M70 — the door from the WIRE into the canonical event. Without it the surface that actually
// receives the stream (every transport-driven consumer) could not reach any presenter.
export * from './source/from-wire-chunk.js'
export * from './presenters/ui-message-stream.js'
export * from './presenters/terminal.js'
export * from './presenters/json.js'

export {
  foldTurnLifecycle,
  type ContentChunk,
  type LifecycleItem,
  type LifecycleVocabulary,
  type TurnLifecycle,
  type TurnOutcome,
} from './turn-lifecycle.js'
