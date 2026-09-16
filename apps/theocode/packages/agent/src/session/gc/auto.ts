/**
 * B-131 / B-132 — the trigger the collector never had.
 *
 * Everything else was already here and already careful: `DEFAULT_WINDOW_DAYS = 30` with
 * `FLOOR_DAYS = 1` and a refusal below it, a 200 000-operation budget sized from a MEASURED ~2.54
 * operations per project over a MEASURED 13 269-project tree, a plan/apply split with a dry run, and
 * an UNDETERMINED-is-KEPT fail-safe on the only path in this product that deletes a user's data.
 *
 * What was missing was that anything ever called it. `sessions gc` is an explicit CLI action
 * (`packages/cli/src/commands/sessions.ts:151`), so between two manual runs the tree only grew, and
 * a human was the scheduler for a procedure whose steps never change — which is the SRE source's
 * definition of toil, and its advice is to remove it rather than measure it.
 *
 * What survives here is the DECISION — is it enabled, is it due, is this the first sweep — and
 * nothing else. The sweep itself moved to a child process (B-142) after the in-process form was
 * measured blocking the event loop for 4.9-37.1 s on the tree this repository cites; `void` cannot
 * make synchronous work asynchronous.
 *
 * The in-process form and its wrapper were DELETED rather than kept "in case": with the CLI trigger
 * gone and the TUI spawning, nothing called them, and knip said so. Dead code with tests is still
 * dead code.
 */

const HOUR_MS = 60 * 60 * 1000

/** What the stamp and the interval say, with no opinion about who does the sweeping. */
export type SweepDecision =
  | { readonly run: false; readonly reason: 'disabled' }
  | { readonly run: false; readonly reason: 'too-soon'; readonly lastRun: Date }
  | { readonly run: true; readonly firstRun: boolean }

/**
 * The decision, extracted so the in-process sweep and the child-process sweep cannot drift.
 *
 * They answer the same three questions — is it enabled, is it due, is this the first one (which must
 * not apply, B-139) — and B-142 gave them two callers. Two copies of that logic is two places for
 * the look-first property to be lost.
 */
export function sweepDecision(opts: {
  readonly enabled: boolean
  readonly now: Date
  readonly intervalHours: number
  readonly lastRun: Date | undefined
}): SweepDecision {
  if (!opts.enabled) return { run: false, reason: 'disabled' }

  // An unusable stamp is treated as NO stamp, in both answers it feeds. Reading it as "some previous
  // run happened" would let a corrupted file skip the look-first dry run (B-139) and apply straight
  // away — the unsafe direction on the one path that deletes a user's data.
  const lastRun =
    opts.lastRun !== undefined && !Number.isNaN(opts.lastRun.getTime()) ? opts.lastRun : undefined

  if (lastRun !== undefined) {
    if (opts.now.getTime() - lastRun.getTime() < opts.intervalHours * HOUR_MS) {
      return { run: false, reason: 'too-soon', lastRun }
    }
  }
  return { run: true, firstRun: lastRun === undefined }
}
