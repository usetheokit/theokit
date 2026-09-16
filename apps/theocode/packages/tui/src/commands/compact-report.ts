/**
 * #126 — what `/compact` says it did.
 *
 * It used to say `Context compacted (~348→~188 tokens)` while the footer read `40.3k/121.6k context`
 * before and after. Two numbers for one word in one frame, and the only readings available to a user
 * were "the compaction is broken" or "the meter is broken" — neither of which is what happened.
 *
 * The numbers are real and measure a different quantity: the SDK's compaction counts the TEXT of
 * user/assistant/system messages, and not `tool_use`/`tool_result` blocks — which on a real session
 * measured ~83% of the transcript. The footer is `lastUsage.inputTokens`, the real figure, and it
 * does not move until the next turn reports usage.
 *
 * The compaction WORKS: 28.7k → 5.5k measured on a real session, tool output genuinely removed. Not
 * being counted is not the same as not being removed.
 *
 * So the numbers stay and are labelled, which is the M94 shape from `SessionFooter.tsx` — one line
 * above the meter this contradicted. A figure whose confidence or scope differs from a measurement
 * has to present itself as such, or it gets trusted as one.
 */
export function compactReport(preTokens: number, postTokens: number): string {
  return (
    `Compacted message text (~${String(preTokens)}→~${String(postTokens)} tokens). ` +
    'Tool output is compacted too but is not counted in those numbers — it is usually the bulk of ' +
    'a session, so the real drop is larger. The context meter updates on the next turn. ' +
    'Heads up: multiple compactions can reduce accuracy; consider /new for unrelated work.'
  )
}
