import { describe, expect, it } from 'vitest'

import { grantGate } from '../../src/auth/permission-gate.js'
import { PermissionStore } from '../../src/auth/permission-store.js'
import { createHitlPlugin } from '../../src/bridge/hitl-plugin.js'
import { dropRunRefusals, recordRefusal, takeRefusal } from '../../src/bridge/refusal-ledger.js'
import { hookFingerprint } from '../../src/hooks/hook-fingerprint.js'
import { buildHookHandlers } from '../../src/hooks/hook-spec.js'

type Handler = (c: {
  name: string
  args: Record<string, unknown>
  agentId: string
  runId: string
}) => unknown

function hitlHandler(decision: unknown): Handler {
  let h: Handler | undefined
  createHitlPlugin({
    gated: new Map([['deploy', { question: 'ok?' }]]) as never,
    emit: () => undefined,
    awaitApproval: () => Promise.resolve(decision as never),
  }).register({ on: (_hook: string, fn: Handler) => (h = fn) } as never)
  return h!
}
const call = (runId: string, name = 'deploy') => ({ name, args: {}, agentId: 'a', runId })

describe('refusal ledger', () => {
  it('two refusals of the same tool in one run are matched in order', () => {
    recordRefusal('r-fifo', 'Bash', { by: 'human', reason: 'first' })
    recordRefusal('r-fifo', 'Bash', { by: 'policy', reason: 'second' })
    recordRefusal('r-other', 'Bash', { by: 'hook' })
    expect(takeRefusal('r-fifo', 'Bash')).toEqual({ by: 'human', reason: 'first' })
    expect(takeRefusal('r-fifo', 'Read')).toBeUndefined()
    expect(takeRefusal('r-fifo', 'Bash')).toEqual({ by: 'policy', reason: 'second' })
    expect(takeRefusal('r-fifo', 'Bash')).toBeUndefined()
    dropRunRefusals('r-other')
    expect(takeRefusal('r-other', 'Bash')).toBeUndefined()
  })

  it("a call denied by the HITL approver yields refusal by human with the approver's reason", async () => {
    const veto = await hitlHandler({ approved: false, reason: 'too risky' })(call('r-h'))
    expect(veto).toMatchObject({
      block: true,
      message: "Tool 'deploy' denied by human approver: too risky",
    })
    expect(takeRefusal('r-h', 'deploy')).toEqual({ by: 'human', reason: 'too risky' })
  })

  it('an approval that timed out yields refusal by timeout', async () => {
    await hitlHandler({ approved: false, settledBy: 'timeout', reason: 'window expired' })(
      call('r-t'),
    )
    expect(takeRefusal('r-t', 'deploy')).toEqual({ by: 'timeout', reason: 'window expired' })
  })

  it('a call blocked by a hook spec yields refusal by hook', async () => {
    const approved = new Set([
      hookFingerprint({ command: 'exit 1', event: 'pre_tool_call', timeoutMs: 5000 }),
    ])
    const handlers = buildHookHandlers(
      [{ event: 'pre_tool_call', command: 'exit 1', timeout_ms: 5000 }],
      { cwd: process.cwd(), trusted: true, approved },
    )
    await handlers.pre_tool_call?.({ name: 'Bash', args: {}, agentId: 'a', runId: 'r-k' } as never)
    expect(takeRefusal('r-k', 'Bash')).toMatchObject({ by: 'hook' })
  })

  it('a call refused by the permission gate yields refusal by policy', async () => {
    const store = new PermissionStore({ home: process.env.TMPDIR ?? '/tmp' })
    const gate = grantGate(store, (c) => ({
      governed: true,
      query: { tool: c.name, scope: '/nonexistent-scope', command: 'x' },
    }))
    await gate({ name: 'Bash', args: {}, agentId: 'a', runId: 'r-p' })
    expect(takeRefusal('r-p', 'Bash')).toMatchObject({ by: 'policy' })
  })
})
