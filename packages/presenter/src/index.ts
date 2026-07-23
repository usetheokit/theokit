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
