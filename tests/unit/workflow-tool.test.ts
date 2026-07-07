import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createWorkflowTool } from '../../packages/theo/src/server/agent/workflow-tool.js'

/**
 * M26 (ADR-0041) — createWorkflowTool: wrap an SDK `Workflow` as a `CustomTool`. THIN adapter —
 * `packages/workflows/` stays G13-forbidden; the workflow ENGINE is the SDK's (`Workflow.run`).
 * This only exposes an already-built `Workflow` to an agent as one callable tool. It calls no LLM,
 * runs no orchestration of its own — it delegates to `workflow.run(input)`.
 */

/** A structural stand-in for the SDK `Workflow` (the adapter never imports the SDK type). */
function fakeWorkflow(
  impl: (input: unknown) => { status: string; output: unknown; runId?: string },
) {
  return { run: vi.fn(async (input: unknown) => impl(input)) }
}

describe('M26 — createWorkflowTool', () => {
  it('produces a CustomTool that delegates to workflow.run(input)', async () => {
    const wf = fakeWorkflow((input) => ({
      status: 'completed',
      output: { echoed: input },
      runId: 'r1',
    }))
    const tool = createWorkflowTool(wf, {
      name: 'run_pipeline',
      description: 'Run the data pipeline',
      inputSchema: z.object({ id: z.string() }),
    })

    expect(tool.name).toBe('run_pipeline')
    expect(tool.description).toBe('Run the data pipeline')

    const result = await tool.handler({ id: 'abc' })
    expect(wf.run).toHaveBeenCalledWith({ id: 'abc' })
    expect(JSON.parse(result)).toEqual({ echoed: { id: 'abc' } })
  })

  it('returns a string output verbatim (no double-encoding)', async () => {
    const wf = fakeWorkflow(() => ({ status: 'completed', output: 'plain text result' }))
    const tool = createWorkflowTool(wf, { name: 'wf', description: 'd' })
    expect(await tool.handler({})).toBe('plain text result')
  })

  it('throws a clear error when the workflow run fails', async () => {
    const wf = fakeWorkflow(() => ({ status: 'failed', output: null, runId: 'r9' }))
    const tool = createWorkflowTool(wf, { name: 'wf', description: 'd' })
    await expect(tool.handler({})).rejects.toThrow(/workflow.*failed/i)
  })

  it('validates input against the schema before running (bad input never reaches the workflow)', async () => {
    const wf = fakeWorkflow(() => ({ status: 'completed', output: 'ok' }))
    const tool = createWorkflowTool(wf, {
      name: 'wf',
      description: 'd',
      inputSchema: z.object({ n: z.number() }),
    })
    await expect(tool.handler({ n: 'not-a-number' })).rejects.toThrow()
    expect(wf.run).not.toHaveBeenCalled()
  })

  it('fails clearly when the passed object is not a Workflow (no .run)', () => {
    expect(() => createWorkflowTool({} as never, { name: 'wf', description: 'd' })).toThrow(
      /Workflow.*run\(\)|does not expose/i,
    )
  })
})
