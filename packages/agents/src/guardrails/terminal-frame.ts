/**
 * #732 — rebuild each round's terminal frame from the moderated text the client actually received.
 *
 * ## The defect
 *
 * With an output guard declared, one turn delivered two different answers: the `text_delta` stream was
 * redacted and `DoneEvent.result` was not. Measured through `AgentRunner.stream()` with a redactor —
 * `text_delta -> "here: [R]"`, `done.result -> "here: sk-abc123"` — so a client rendering the terminal
 * frame received the secret the guard was declared to remove.
 *
 * ## Why not a third `moderateOutputStream` pass
 *
 * The comment in `agent-runner.ts` states the constraint and it is the reason this is its own module:
 * there is one `done` per SDK round while moderation spans the whole stream, so a pass keyed on `done`
 * would collapse every round's frame into one. Feeding it the whole-stream aggregate would give the
 * second round the first round's text appended.
 *
 * ## Why mirroring is exact rather than approximate
 *
 * `done.result` is not an independent channel: it carries the visible text of its OWN round, a mirror
 * of that round's `text_delta` content. So the round's moderated deltas ARE the answer, and rebuilding
 * from them cannot diverge from what the client saw — no guard is re-run, and no text is invented.
 *
 * This runs AFTER the moderation passes, which is what makes it correct: the deltas it accumulates are
 * already the moderated ones.
 *
 * ## What it deliberately does not touch
 *
 * A frame whose round produced no `text_delta` keeps what the SDK reported. A tool-only round
 * legitimately has no visible text, and replacing its result with `''` would delete information rather
 * than moderate it — the opposite direction from the one this fix is for.
 */

/** The shape this reads. Structural on purpose: it runs over the stream's events, not over a class. */
interface TextBearing {
  readonly type: string
  readonly content?: unknown
  readonly result?: unknown
}

/**
 * Yield every event unchanged except `done`, whose `result` becomes its round's moderated text.
 *
 * A round is the span between terminal frames, which is exactly how the SDK emits them.
 */
export async function* mirrorModeratedText<E extends TextBearing, R>(
  inner: AsyncGenerator<E, R>,
): AsyncGenerator<E, R> {
  let round = ''
  let sawText = false
  let step = await inner.next()
  while (!step.done) {
    const event = step.value
    if (event.type === 'text_delta' && typeof event.content === 'string') {
      round += event.content
      sawText = true
    }
    if (event.type === 'done') {
      yield sawText ? { ...event, result: round } : event
      round = ''
      sawText = false
    } else {
      yield event
    }
    step = await inner.next()
  }
  return step.value
}
