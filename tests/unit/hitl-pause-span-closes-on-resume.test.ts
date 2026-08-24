import { describe, it, expect, vi } from 'vitest'

import {
  closePauseSpan,
  registerPauseSpan,
  _resetPauseSpansForTests,
} from '../../packages/theo/src/server/agent/hitl-pause-spans.js'
import type { SpanHandle } from '../../packages/theo/src/server/observability/adapters/types.js'

/**
 * B-028 — the `agent.hitl` span measured the human's wait PLUS the model's
 * latency, and only the human was asked for.
 *
 * `closeToolSpan` ended the pause on `tool-output-available`, and its comment
 * stated the premise: "the tool producing output IS the resume". The wire
 * refuted it. With the approval answered at ~3306 ms that chunk arrived at
 * 4829 ms, and across three runs varying only the model's post-resume latency
 * the excess tracked it 1:1 — 20 ms / +30 ms, 700 ms / +723 ms, 1500 ms /
 * +1524 ms. The premise holds only when the model is instantaneous, which is
 * the one case nobody deploys.
 *
 * The resume happens on a DIFFERENT request — the approve endpoint — which the
 * run's observer never sees. So the span moves to a registry both can reach,
 * and whoever observes the resume first closes it.
 *
 * Closing is idempotent by construction rather than by luck: the module owns the
 * handle, so a later `tool-output-available` for the same call cannot re-close a
 * span the approval already ended, and cannot overwrite the duration that made
 * it correct.
 */

function fakeSpan(): SpanHandle & { ended: number; attrs: Record<string, unknown> } {
  const attrs: Record<string, unknown> = {}
  let ended = 0
  return {
    attrs,
    get ended() {
      return ended
    },
    setAttribute: (k: string, v: string | number | boolean) => {
      attrs[k] = v
    },
    setStatus: vi.fn(),
    end: () => {
      ended += 1
    },
  } as never
}

describe('the HITL pause span closes when the human answers (B-028)', () => {
  it('test_closing_on_resume_ends_the_span_once', () => {
    _resetPauseSpansForTests()
    const span = fakeSpan()
    registerPauseSpan('ap-1', span)

    closePauseSpan('ap-1', { resumeObserved: true })

    expect(span.ended).toBe(1)
    expect(span.attrs['hitl.resume_observed']).toBe(true)
  })

  it('test_a_later_close_cannot_re_end_it', () => {
    // The tool result still arrives, seconds later, and used to be what ended
    // the span. If it could end it again the duration would be the model's too —
    // the whole defect, reintroduced through the fallback path.
    _resetPauseSpansForTests()
    const span = fakeSpan()
    registerPauseSpan('ap-2', span)

    closePauseSpan('ap-2', { resumeObserved: true })
    closePauseSpan('ap-2', { resumeObserved: true })

    expect(span.ended).toBe(1)
  })

  it('test_a_span_that_never_resumed_is_marked_as_such', () => {
    // The sweep path: a client disconnected, or the approval timed out. The
    // duration is not the human's wait and the span must not claim it is.
    _resetPauseSpansForTests()
    const span = fakeSpan()
    registerPauseSpan('ap-3', span)

    closePauseSpan('ap-3', { resumeObserved: false })

    expect(span.ended).toBe(1)
    expect(span.attrs['hitl.resume_observed']).toBe(false)
  })

  it('test_closing_an_unknown_approval_is_a_no_op', () => {
    // The approve endpoint runs for approvals raised on runs with no
    // observability adapter, and for ids that were never pauses at all.
    _resetPauseSpansForTests()

    expect(() => closePauseSpan('never-registered', { resumeObserved: true })).not.toThrow()
  })

  it('test_a_closed_span_is_forgotten_rather_than_retained', () => {
    // A process-wide map that only grows is a leak, and this one is keyed by a
    // value an external caller supplies.
    _resetPauseSpansForTests()
    const first = fakeSpan()
    registerPauseSpan('ap-4', first)
    closePauseSpan('ap-4', { resumeObserved: true })

    const second = fakeSpan()
    registerPauseSpan('ap-4', second)
    closePauseSpan('ap-4', { resumeObserved: true })

    // The second registration under a reused id closes the SECOND span, not a
    // stale handle from the first.
    expect(second.ended).toBe(1)
    expect(first.ended).toBe(1)
  })
})
