/**
 * B-079 + B-080 — which decomposition the judge reads.
 *
 * `GoalOptions.subgoals` is fed to the judge prompt and is supplied by the CALLER. Measured
 * 2026-09-14, `packages/agents/src` produced it in **0** files, so the agent was graded against a
 * breakdown somebody else wrote — and a wrong breakdown was charged to the agent as failure.
 *
 * ## Why this is a named function rather than a `??`
 *
 * The reviewer decided on 2026-09-14 that the AGENT's decomposition wins: a caller's list is a
 * starting value, never a verdict. Written inline, that rule would live in whichever order the
 * arguments happened to be spread, and the same defect would come back with an accidental cause
 * instead of a decided one. A function can be named, tested, and FAILED when inverted.
 *
 * ## `[]` and `undefined` are different instructions
 *
 * An empty array says "no subgoals"; absence says "nothing was specified". Collapsing them would
 * make a caller who deliberately passed `[]` indistinguishable from one who passed nothing, and the
 * judge reads those differently.
 */

/**
 * The decomposition the judge should read.
 *
 * @param callerSubgoals what the embedder passed in `GoalOptions.subgoals`, if anything
 * @param declared what the agent declared through `task_declare` this run
 */
export function resolveDecomposition(
  callerSubgoals: readonly string[] | undefined,
  declared: readonly string[],
): readonly string[] | undefined {
  // The agent's wins whenever it declared anything. This is the reviewer's decision and the reason
  // the whole item exists — grading somebody against a plan they did not write is the defect.
  if (declared.length > 0) return declared
  return callerSubgoals
}
