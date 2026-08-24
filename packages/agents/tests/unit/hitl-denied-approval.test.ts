/**
 * A denied approval must not capture the NEXT call of the same tool (usetheokit/theokit#414).
 *
 * `HitlCallCorrelation` pairs the plugin's approval id with the SDK's runtime call id by tool NAME,
 * FIFO, and its soundness argument is that "an approval is outstanding only while the call it gates
 * is outstanding". That holds on the approve path. On the DENY path the SDK vetoes in
 * `pre_tool_call`, so the approval settles and the call it gated never becomes outstanding — the id
 * stayed queued for the lifetime of the stream and was claimed by a later, unrelated call.
 *
 * Two user-visible consequences, both silent:
 *
 * 1. `announceToolCall` answered `'already-announced'` for the second call, so the presenter yielded
 *    `null` and its `tool-call` chunk never reached the wire at all.
 * 2. Its result was emitted under the FIRST, denied approval's id, so a client grouping by
 *    `toolCallId` attached the second call's output to the denied card.
 */
import { describe, expect, it } from 'vitest'

import { HitlCallCorrelation } from '../../src/bridge/hitl-call-correlation.js'

describe('HitlCallCorrelation — an approval that settles without dispatching (#414)', () => {
  it('does not let a denied approval capture the next call of the same tool', () => {
    const c = new HitlCallCorrelation()

    // `deploy` is gated; the approval reaches the wire before any runtime call.
    expect(c.approvalToolCallId('deploy', 'A1')).toBe('A1')

    // The human denies. The SDK vetoes in `pre_tool_call`, so no runtime call is dispatched — but
    // the veto still produces a RESULT for the gated call, and that is the event that tells the
    // correlation the approval is over. The refusal keeps the RUNTIME id rather than claiming the
    // approval's: see the second case below for the measurement behind that restraint.
    expect(c.resultToolCallId('deploy', 'call1')).toBe('call1')

    // The model calls `deploy` again. A fresh approval, a fresh id.
    expect(c.approvalToolCallId('deploy', 'A2')).toBe('A2')

    // The human approves, so this one IS dispatched.
    expect(c.announceToolCall('deploy', 'call2')).toBe('already-announced')

    // The id the wire must use for call2 is A2 — the approval that gates it.
    expect(c.resultToolCallId('deploy', 'call2')).toBe('A2')
  })

  it('does not settle the card of a call the human ALLOWED', () => {
    // The restraint, measured. Claiming the stale approval on the result path is the obvious fix
    // and it is wrong in a mixed concurrent round: with A1 and A2 outstanding and only the SECOND
    // call approved, `announceToolCall` claims A1 for it (FIFO by name) — so claiming here would
    // land the first call's refusal on A2, showing a refusal for something the human allowed.
    //
    // A hanging card is bad; a card that reports a refusal the human did not give is worse. So the
    // stale id is DROPPED and the refusal keeps the runtime id, exactly as before — this case
    // asserts the no-worsening, not a fix.
    const c = new HitlCallCorrelation()

    expect(c.approvalToolCallId('deploy', 'A1')).toBe('A1')
    expect(c.approvalToolCallId('deploy', 'A2')).toBe('A2')
    expect(c.announceToolCall('deploy', 'call2')).toBe('already-announced')

    // The veto of the first call does NOT claim A2.
    expect(c.resultToolCallId('deploy', 'call1')).not.toBe('A2')
  })

  it('leaves an ungated tool alone', () => {
    // The correlation must stay identity for a call no approval ever claimed — that is what keeps
    // the non-HITL wire byte-unchanged.
    const c = new HitlCallCorrelation()

    expect(c.announceToolCall('search', 'call-1')).toBe('announce')
    expect(c.resultToolCallId('search', 'call-1')).toBe('call-1')
  })

  it('pairs two concurrent gated calls with their own approvals', () => {
    // FIFO across a round the SDK dispatched concurrently: the fix must not reorder this.
    const c = new HitlCallCorrelation()

    expect(c.approvalToolCallId('deploy', 'A1')).toBe('A1')
    expect(c.approvalToolCallId('deploy', 'A2')).toBe('A2')
    expect(c.announceToolCall('deploy', 'call1')).toBe('already-announced')
    expect(c.announceToolCall('deploy', 'call2')).toBe('already-announced')

    expect(c.resultToolCallId('deploy', 'call1')).toBe('A1')
    expect(c.resultToolCallId('deploy', 'call2')).toBe('A2')
  })
})
