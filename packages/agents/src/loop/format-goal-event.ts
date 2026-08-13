import type { GoalEvent } from '@theokit/sdk'

/**
 * M69 — render one {@link GoalEvent} as a line, exhaustively and safely.
 *
 * ## Why this exists
 *
 * `GoalEvent` is a closed discriminated union of five variants. Every consumer that renders a goal
 * run switched on it, and TypeScript made that switch exhaustive against the types they had
 * installed — which is precisely the problem: the day the SDK adds a sixth variant in a minor, each
 * of those switches is silently non-exhaustive at runtime while still compiling.
 *
 * So every consumer wrote the same default branch for an event it could not name. This function is
 * that branch, written once, where the knowledge belongs.
 *
 * ## Exhaustive-safe means both halves
 *
 * **Compile time:** the `never` assignment at the end of the switch fails the build if a variant is
 * added to the union — here, in the one file that claims to know them all, rather than in every
 * consumer.
 *
 * **Run time:** an event whose `type` this build does not recognise is still formatted, and the line
 * says so. A render path that throws on a forward-compatible event turns an SDK minor into a
 * crashed UI; a line that pretends to understand it is worse, because nobody notices. The honest
 * output names the type and marks it unrecognised.
 *
 * The milestone allowed marking the published union OPEN instead. That was rejected: an open union
 * makes the default branch *required*, which is the opposite of the stated goal — the consumer
 * stops writing it.
 */
export function formatGoalEvent(event: GoalEvent): string {
  // Widened on purpose. The declared type says a malformed value cannot arrive; the wire says
  // otherwise — this argument crosses a process boundary in every real deployment, and the linter
  // is right that the check is impossible *according to the types*. That is the point: the types
  // describe what a well-behaved producer sends, and this branch exists for the other case.
  const candidate = event as unknown
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    typeof (candidate as { type?: unknown }).type !== 'string'
  ) {
    return '[goal] unrecognised event (malformed)'
  }

  switch (event.type) {
    case 'turn_start':
      return `[goal] turn ${event.turn} started — ${event.goal}`
    case 'agent_response':
      return `[goal] turn ${event.turn} response: ${event.content}`
    case 'judge_verdict':
      return (
        `[goal] turn ${event.turn} judged ${event.verdict}: ${event.reason}` +
        // Surfaced rather than hidden: a verdict the judge could not parse reached a decision by
        // fallback, and an operator reading the log needs to know which of the two happened.
        (event.parseFailed ? ' (verdict could not be parsed)' : '')
      )
    case 'continuation':
      return `[goal] turn ${event.turn} continuing: ${event.prompt}`
    case 'status_change':
      return `[goal] status ${event.status}: ${event.reason}`
    default:
      return formatUnrecognised(event)
  }
}

/**
 * The two halves of "an event this build does not know", kept together.
 *
 * The `never` parameter is the compile-time assertion: when a variant joins `GoalEvent`, the switch
 * above stops covering it, the narrowed type is no longer `never`, and this call fails to compile.
 * The body is the runtime answer for the same situation seen from an older build.
 */
function formatUnrecognised(event: never): string {
  const { type } = event as { type?: unknown }
  return `[goal] unrecognised event: ${String(type)}`
}
