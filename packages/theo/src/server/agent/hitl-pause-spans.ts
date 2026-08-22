/**
 * B-028 — where a HITL pause span lives between the pause and the resume.
 *
 * ## Why this module exists at all
 *
 * The pause span used to be closed by the run's own observer, on
 * `tool-output-available`, under the premise that "the tool producing output IS the resume". The
 * wire refuted it: with the approval answered at ~3306 ms that chunk arrived at 4829 ms, and across
 * three runs varying only the model's post-resume latency the excess tracked it 1:1. The premise
 * holds only when the model is instantaneous, which is the one case nobody deploys — so the span
 * reported the human's wait plus the model's, and only the human was asked for.
 *
 * The resume happens on a **different HTTP request** — the approve endpoint — which the run's
 * observer never sees. Neither side can close the span alone, so the handle lives here, where both
 * reach it by approval id.
 *
 * ## Idempotent by construction, not by discipline
 *
 * The module owns the handle and drops it on close, so the tool result arriving seconds later
 * cannot re-close a span the approval already ended — which is the original defect finding its way
 * back through the fallback path. Whoever observes the resume first ends the span; everyone after
 * is a no-op.
 *
 * ## The limit, stated
 *
 * In-process, like the approval registry it shadows (ADR 0038): the span handle is a live object,
 * so the pause and the resume must be in one process. A multi-instance deploy resumes on whichever
 * instance the approve request reaches, and there the span falls through to the run's end-of-run
 * sweep and is marked as never observed to resume — the honest reading, and the same envelope
 * `B-027` records for the rate-limit store.
 */
import type { SpanHandle } from '../observability/adapters/types.js'

const pauseSpans = new Map<string, SpanHandle>()

/** Hand the pause span for `approvalId` to whoever observes the resume. */
export function registerPauseSpan(approvalId: string, span: SpanHandle): void {
  pauseSpans.set(approvalId, span)
}

/**
 * End the pause span for `approvalId`, if one is still open.
 *
 * `resumeObserved` is said positively on purpose: an operator reading a four-minute pause has no
 * other way to tell "the human thought for four minutes" from "we never saw the resume".
 *
 * A no-op for an unknown id, which covers the ordinary cases rather than an error path — an
 * approval raised on a run with no observability adapter, an id already closed, and an approve
 * request for something that was never a pause.
 */
export function closePauseSpan(
  approvalId: string,
  { resumeObserved }: { resumeObserved: boolean },
): void {
  const span = pauseSpans.get(approvalId)
  if (span === undefined) return
  pauseSpans.delete(approvalId)

  span.setAttribute('hitl.resume_observed', resumeObserved)
  if (resumeObserved) span.setStatus('ok')
  else
    span.setStatus('error', 'HITL pause never observed to resume; duration is not the human wait')
  span.end()
}

/** Drop the handle without ending it — the run is gone and nobody will resume. */
export function forgetPauseSpan(approvalId: string): void {
  pauseSpans.delete(approvalId)
}

/** @internal test seam — the map is process-wide and tests must not inherit each other's. */
export function _resetPauseSpansForTests(): void {
  pauseSpans.clear()
}
