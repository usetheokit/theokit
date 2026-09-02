/**
 * The model is typing the SDK's own replay marker — say so, once (usetheokit/theokit#631).
 *
 * ## What was measured
 *
 * A consumer reported an assistant message reaching `agent.thread` as
 * `"…report its output.[tool call] run_shell"`, with no `tool_use` part in it. Read from the
 * published `@theokit/sdk@4.63.3` tarball, the chain is:
 *
 * 1. a resumed send hydrates the session (`chunk-25BD2R5G.js:9767`);
 * 2. hydration narrows every stored message to BOTH projections — `text`, in which a tool call folds
 *    to `[tool call] NAME`, and the structured `parts` (`narrowToSessionMessage`);
 * 3. the replay then builds the model's history from `text` alone
 *    (`chunk-25BD2R5G.js:4965`: `content: [{ type: 'text', text: msg.text }]`). `grep` for
 *    `msg.parts` across that bundle returns nothing.
 *
 * So the model's own history says `assistant: …\n[tool call] run_shell`, and the model does the
 * reasonable thing with a pattern it is shown: it writes the marker instead of calling the tool.
 * Filed upstream as usetheodev/theokit-sdk#523.
 *
 * ## Why this notices and does not fix
 *
 * The marker is a SYMPTOM. The tool did not run — stripping the string would leave a message
 * describing an action that never happened, which is worse than the string: it would turn a visible
 * defect into an invisible one, and this repository's error-handling rules call that swallowing.
 *
 * What this repository CAN close is the cost the report actually names: *"It cost me a wrong
 * diagnosis and a prompt change aimed at the model before I traced the string into the SDK bundle."*
 * A marker that names its own origin is the difference between an afternoon in a bundle and one
 * line in a log.
 *
 * ## Why once
 *
 * Same reason the undeclared-route warning is emitted once per route rather than once per request:
 * a line repeated per token is a line that gets filtered out. Once per process is enough — the
 * condition is a property of the session's history, not of any single delta.
 *
 * ## The false positive, stated
 *
 * An assistant discussing this very defect can legitimately write `[tool call] run_shell` in an
 * answer. It gets one warning line and nothing else: the text is untouched, no event changes, no
 * stream is altered. That asymmetry is why the notice is a warning rather than a transform.
 */

/**
 * The SDK's fold markers, verbatim from `partToText`:
 *
 * ```js
 * if (p.type === "tool_use")    return `[tool call] ${p.name ?? ""}`;
 * if (p.type === "tool_result") return `[tool result] ${body}`;
 * ```
 *
 * Each requires a following non-space character, because the SDK always renders a name or a body
 * after it — `[tool call]` on its own is prose about tools, not the fold.
 */
const REPLAY_MARKERS: readonly RegExp[] = [/\[tool call\] \S/, /\[tool result\] \S/]

let notified = false

/** Does this text carry a marker only the SDK's flat projection produces? */
export function detectsReplayMarker(text: string): boolean {
  return REPLAY_MARKERS.some((marker) => marker.test(text))
}

/**
 * Warn once when assistant text carries the marker. Returns nothing, on purpose.
 *
 * The first draft returned the text so a call site could read as a pass-through — and a linter was
 * right to object that the return value carries no information. `void` states the contract better
 * than the pass-through did: this OBSERVES a stream it does not own, and a call site that has to
 * write `noteReplayMarker(text)` on its own line cannot be mistaken for one that filters.
 *
 * @param text assistant text about to be emitted; never modified, never retained
 */
export function noteReplayMarker(text: string): void {
  if (notified || !detectsReplayMarker(text)) return
  notified = true
  console.warn(
    '[theokit] agents.bridge: assistant text contains "[tool call] …", which is @theokit/sdk\'s ' +
      'flat rendering of a stored tool call, not something the model invented. A RESUMED session ' +
      'replays its history through that projection (SessionMessage.text), so the model is shown the ' +
      'marker and imitates it instead of calling the tool — the call did NOT run. Changing your ' +
      'prompt will not fix it: see usetheokit/theokit#631 and usetheodev/theokit-sdk#523.',
  )
}

/** Reset the once-per-process latch. Tests only — a run never needs it. */
export function resetReplayMarkerNotice(): void {
  notified = false
}
