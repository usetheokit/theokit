/**
 * The veto message must not invent an approver (usetheokit/theokit#393).
 *
 * `Tool 'send_email' denied by human approver` was emitted for BOTH an explicit deny with no
 * reason and an approval window that closed with nobody watching. The model reading it, and the
 * operator auditing it, were told a reviewer decided — which in the second case did not happen.
 */
import { describe, expect, it, vi } from 'vitest'

import { createHitlPlugin, type HitlWiring } from '../../src/bridge/hitl-plugin.js'

type Veto = { block: boolean; message: string } | undefined
type PreToolHandler = (c: { name: string; args: unknown }) => Promise<Veto>

function handlerFor(decision: unknown): PreToolHandler {
  let handler: PreToolHandler | undefined
  const wiring = {
    gated: new Map([['send_email', { question: 'Send this email?', timeout: 2000 }]]),
    emit: vi.fn(),
    awaitApproval: async () => decision,
  } as unknown as HitlWiring
  createHitlPlugin(wiring).register({
    on: (hook: string, h: PreToolHandler) => {
      if (hook === 'pre_tool_call') handler = h
    },
  } as never)
  if (!handler) throw new Error('plugin registered no pre_tool_call handler')
  return handler
}

const CALL = { name: 'send_email', args: { to: 'ops@example.com' } }

describe('the veto message distinguishes an expiry from a denial (#393)', () => {
  it('does not claim a human approver when the window expired', async () => {
    const veto = await handlerFor({
      approved: false,
      settledBy: 'timeout',
      reason: "no decision within 2000 ms; onTimeout: 'abort' was applied",
    })(CALL)

    expect(veto?.block).toBe(true)
    expect(veto?.message).not.toContain('human approver')
  })

  it('names the budget, the configured action and what to change', async () => {
    const veto = await handlerFor({
      approved: false,
      settledBy: 'timeout',
      reason: "no decision within 2000 ms; onTimeout: 'abort' was applied",
    })(CALL)

    expect(veto?.message).toContain('send_email')
    expect(veto?.message).toContain('2000')
    expect(veto?.message).toContain('abort')
    // The knob that would widen the window — an operator who reads this should not have to go
    // looking for which option governs it.
    expect(veto?.message).toContain('timeout')
  })

  it('still says a human denied it when a human did', async () => {
    // The counter-proof. Marking every denial as an expiry would trade one wrong sentence for
    // another, and this is the path that carries the reviewer's own words.
    const veto = await handlerFor({ approved: false, reason: 'wrong recipient' })(CALL)

    expect(veto?.message).toContain('human approver')
    expect(veto?.message).toContain('wrong recipient')
  })

  it('lets a timed-out proceed through, with no veto to phrase', async () => {
    // `onTimeout: 'proceed'` allows the tool. There is no message on the allow path — the marker
    // exists there for the audit trail, not for the model.
    const veto = await handlerFor({ approved: true, settledBy: 'timeout' })(CALL)

    expect(veto).toBeUndefined()
  })
})
