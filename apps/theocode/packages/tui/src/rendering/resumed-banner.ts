import { AGENT } from '@theocode/shared/agent'

/**
 * What the transcript area says when it opens.
 *
 * #70 — after `/resume` the screen used to be the welcome banner and an empty transcript, which is
 * exactly what a command that did nothing looks like. This line was the first half of the fix: say it
 * out loud, so "it worked" and "it did nothing" stop looking identical.
 *
 * The turns themselves are drawn now (`useResumedHistory`), so the sentence is no longer carrying the
 * whole answer. It stays, and it stays worded as a claim about MEMORY rather than about the screen:
 * the transcript shows what was said, and this says the model still has it — two different facts, and
 * a resumed session with a short history would otherwise leave the second one unstated.
 *
 * Extracted so the sentence has a test. It was an inline ternary inside `useTimeline`, reachable
 * only by rendering the whole timeline, which is why nothing pinned it and why the half that was
 * missing stayed missing.
 *
 * It names `/new` in the same breath deliberately: a user who did not mean to resume needs the way
 * out where they read the state, not somewhere they have to go looking for it.
 */
export function greetingFor(resumed: boolean): string {
  return resumed
    ? `${AGENT.greeting} (resumed — I remember our last conversation; /new to start fresh)`
    : AGENT.greeting
}
