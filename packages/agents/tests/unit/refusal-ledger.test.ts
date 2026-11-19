import { describe, expect, it } from 'vitest'

import { grantGate } from '../../src/auth/permission-gate.js'
import { PermissionStore } from '../../src/auth/permission-store.js'
import { createHitlPlugin } from '../../src/bridge/hitl-plugin.js'
import {
  dropRunRefusals,
  recordRefusal,
  retainRun,
  takeRefusal,
} from '../../src/bridge/refusal-ledger.js'
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
    recordRefusal('r-fifo', 'Bash', { by: 'human', reason: 'first' }, 'm')
    recordRefusal('r-fifo', 'Bash', { by: 'policy', reason: 'second' }, 'm')
    recordRefusal('r-other', 'Bash', { by: 'hook' }, 'm')
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
      message: expect.stringContaining("Tool 'deploy' denied by human approver: too risky"),
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

  it('a hook command veto records the bare output as reason and keeps the fenced message', async () => {
    const command = 'echo nope-from-hook; exit 1'
    const approved = new Set([
      hookFingerprint({ command, event: 'pre_tool_call', timeoutMs: 5000 }),
    ])
    const handlers = buildHookHandlers([{ event: 'pre_tool_call', command, timeout_ms: 5000 }], {
      cwd: process.cwd(),
      trusted: true,
      approved,
    })
    const veto = (await handlers.pre_tool_call?.({
      name: 'Bash',
      args: {},
      agentId: 'a',
      runId: 'r-kb',
    } as never)) as { message: string }
    const entry = takeRefusal('r-kb', 'Bash', veto.message)
    expect(entry).toEqual({ by: 'hook', reason: 'nope-from-hook\n' })
    expect(veto.message).not.toBe('nope-from-hook')
    expect(veto.message).toContain('nope-from-hook')
  })

  it('a denial takes only the entry whose marker it carries, even when texts are identical', () => {
    const a1 = recordRefusal('r-m', 'Bash', { by: 'human', reason: 'a' }, 'same')
    const a2 = recordRefusal('r-m', 'Bash', { by: 'policy', reason: 'b' }, 'same')
    expect(a1).not.toBe(a2)
    expect(takeRefusal('r-m', 'Bash', 'external says no')).toBeUndefined()
    expect(takeRefusal('r-m', 'Bash', `Plugin blocked: ${a2}`)).toEqual({
      by: 'policy',
      reason: 'b',
    })
    expect(takeRefusal('r-m', 'Bash', a2)).toBeUndefined()
    expect(takeRefusal('r-m', 'Bash', a1)).toEqual({ by: 'human', reason: 'a' })
  })

  it('a marker quoted inside a denial does not select another outstanding entry', () => {
    const a = recordRefusal('r-q', 'Bash', { by: 'human', reason: 'a' }, 'first')
    const b = recordRefusal('r-q', 'Bash', { by: 'policy', reason: 'b' }, `hook output ${a}`)
    expect(takeRefusal('r-q', 'Bash', b)).toEqual({ by: 'policy', reason: 'b' })
    expect(takeRefusal('r-q', 'Bash', a)).toEqual({ by: 'human', reason: 'a' })
    dropRunRefusals('r-q')
    const c = recordRefusal('r-q2', 'Bash', { by: 'human' }, 'x')
    expect(takeRefusal('r-q2', 'Bash', 'external [veto:000000000000000000000000]')).toBeUndefined()
    expect(takeRefusal('r-q2', 'Bash', c)).toEqual({ by: 'human' })
  })

  it('runs that never take or drop their entries are bounded', () => {
    for (let r = 0; r < 600; r++) recordRefusal(`r-leak-${r}`, 'Bash', { by: 'policy' }, 'm')
    expect(takeRefusal('r-leak-0', 'Bash')).toBeUndefined()
    expect(takeRefusal('r-leak-599', 'Bash')).toEqual({ by: 'policy' })
    for (let i = 0; i < 600; i++) {
      recordRefusal('r-big', 'Bash', { by: 'policy', reason: `${i}` }, 'm')
    }
    expect(takeRefusal('r-big', 'Bash')).toEqual({ by: 'policy', reason: '344' })
    dropRunRefusals('r-big')
  })

  it('flooding with unmanaged runs does not evict a retained adapter run', () => {
    const m = recordRefusal('r-live', 'Bash', { by: 'human', reason: 'live' }, 'm')
    retainRun('r-live')
    for (let r = 0; r < 600; r++) recordRefusal(`r-flood-${r}`, 'Bash', { by: 'policy' }, 'm')
    expect(takeRefusal('r-live', 'Bash', m)).toEqual({ by: 'human', reason: 'live' })
  })

  it('an external denial that quotes or copies a veto marker does not consume the veto', () => {
    const veto = recordRefusal('r-ext', 'Bash', { by: 'human', reason: 'real' }, 'blocked')
    expect(takeRefusal('r-ext', 'Bash', `external: ${veto} (and more text)`)).toBeUndefined()
    expect(takeRefusal('r-ext', 'Bash', veto.slice(veto.indexOf('[veto:')))).toBeUndefined()
    expect(takeRefusal('r-ext', 'Bash', `Plugin blocked: ${veto}`)).toEqual({
      by: 'human',
      reason: 'real',
    })
  })

  it('interleaved framework and external denials are each classified by their own message', () => {
    const v1 = recordRefusal('r-il', 'Bash', { by: 'human', reason: 'one' }, 'same')
    const v2 = recordRefusal('r-il', 'Bash', { by: 'policy', reason: 'two' }, 'same')
    expect(takeRefusal('r-il', 'Bash', `ext quoting ${v1} then more`)).toBeUndefined()
    expect(takeRefusal('r-il', 'Bash', `blocked: ${v2}`)).toEqual({ by: 'policy', reason: 'two' })
    expect(takeRefusal('r-il', 'Bash', 'plain external')).toBeUndefined()
    expect(takeRefusal('r-il', 'Bash', `blocked: ${v1}`)).toEqual({ by: 'human', reason: 'one' })
  })

  it('a denial carrying several markers is matched only by its trailing one', () => {
    const v1 = recordRefusal('r-multi', 'Bash', { by: 'human', reason: 'one' }, 'same')
    const v2 = recordRefusal('r-multi', 'Bash', { by: 'policy', reason: 'two' }, 'same')
    expect(takeRefusal('r-multi', 'Bash', `${v2} then ${v1}`)).toEqual({
      by: 'human',
      reason: 'one',
    })
    expect(takeRefusal('r-multi', 'Bash', `${v1} then ${v2}`)).toEqual({
      by: 'policy',
      reason: 'two',
    })
  })

  it('a retained run keeps every entry past the per-run bound', () => {
    retainRun('r-many')
    const first = recordRefusal('r-many', 'Bash', { by: 'human', reason: 'first' }, 'm')
    for (let i = 0; i < 300; i++) recordRefusal('r-many', 'Bash', { by: 'policy' }, 'm')
    expect(takeRefusal('r-many', 'Bash', first)).toEqual({ by: 'human', reason: 'first' })
    dropRunRefusals('r-many')
  })

  it('retained runs are never evicted by the run bound', () => {
    const ids = Array.from({ length: 300 }, (_, i) => `r-ret-${i}`)
    const tags = ids.map((id) => {
      retainRun(id)
      return recordRefusal(id, 'Bash', { by: 'human', reason: id }, 'm')
    })
    expect(takeRefusal(ids[0], 'Bash', tags[0])).toEqual({ by: 'human', reason: ids[0] })
    for (const id of ids) dropRunRefusals(id)
  })

  it('draining a retained run keeps it retained until dropped', () => {
    retainRun('r-drain')
    const a = recordRefusal('r-drain', 'Bash', { by: 'human' }, 'm')
    expect(takeRefusal('r-drain', 'Bash', a)).toEqual({ by: 'human' })
    for (let r = 0; r < 600; r++) recordRefusal(`r-dflood-${r}`, 'Bash', { by: 'policy' }, 'm')
    for (let i = 0; i < 300; i++) recordRefusal('r-drain', 'Bash', { by: 'policy' }, 'm')
    const b = recordRefusal('r-drain', 'Bash', { by: 'human', reason: 'late' }, 'm')
    // 300 earlier entries remain: the retained run was not capped after draining.
    expect(takeRefusal('r-drain', 'Bash', b)).toEqual({ by: 'human', reason: 'late' })
    dropRunRefusals('r-drain')
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
