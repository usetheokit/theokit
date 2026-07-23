/**
 * `@theokit/presenter` — TheoKit's presentation layer (M49).
 *
 * The canonical {@link AgentOutputEvent} (the narrow waist) + the {@link Presenter} Strategy contract +
 * registry. Sources (SDK) translate INTO the canonical event; presenters (web / terminal / json) translate
 * OUT of it — so agent output is normalized once and every surface reuses it.
 *
 * @packageDocumentation
 */
export * from './agent-output-event.js'
export * from './presenter.js'
