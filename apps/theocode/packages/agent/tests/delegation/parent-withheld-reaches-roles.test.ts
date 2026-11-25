/**
 * What the parent withholds reaches every team member: the tool passes its `withheldBuiltinTools` to
 * `buildRoleAgent`, and a role built from it withholds those AND `shell`.
 */
import { describe, expect, it, vi } from 'vitest'

import { createDelegateToTeamTool } from '../../src/delegation/squad.js'
import { fakeMember } from './team-harness.js'

const seen = vi.hoisted(() => ({ ctxs: [] as Array<Record<string, unknown>> }))
vi.mock('../../src/delegation/roles.js', async (orig) => ({
  ...(await orig<typeof import('../../src/delegation/roles.js')>()),
  buildRoleAgent: vi.fn(async (_name: string, ctx: Record<string, unknown>) => {
    seen.ctxs.push(ctx)
    return fakeMember({ name: 'm' })
  }),
}))

describe('the parent withheld builtins reach the roles', () => {
  it('delegate_to_team hands each member the parent list', async () => {
    seen.ctxs = []
    const tool = createDelegateToTeamTool({
      model: 'm',
      reasoning_effort: undefined,
      sandbox_mode: 'workspace-write',
      posture: 'trusted',
      cwd: process.cwd(),
      withheldBuiltinTools: ['shell', 'memory_search'],
    } as never) as unknown as { handler: (i: { task: string }) => Promise<string> }
    await tool.handler({ task: 'x' })
    expect(seen.ctxs).toHaveLength(2)
    for (const ctx of seen.ctxs) expect(ctx.withheldBuiltinTools).toEqual(['shell', 'memory_search'])
  })
})
