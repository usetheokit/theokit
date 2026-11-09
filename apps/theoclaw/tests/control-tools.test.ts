/**
 * B-611 — the tools `controlAgentToolOptions` adds for the `/control` agent beyond `run_code` and
 * `delegate_all`: the question tool with no asker, and the task tools over one registry per agent.
 */
import { describe, expect, it } from 'vitest'

import type { CustomTool } from '@theokit/sdk'

import { questionTool, taskTools } from '../src/tools/control-tools.js'

/** The tool's answer, parsed: these tools answer a JSON string. */
async function call<T>(tool: CustomTool, input: Record<string, unknown>): Promise<T> {
  const answer = await tool.handler(input)
  if (typeof answer !== 'string') throw new Error(`${tool.name} answered content blocks, not a JSON string`)
  return JSON.parse(answer) as T
}

function byName(tools: readonly CustomTool[], name: string): CustomTool {
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error(`no ${name} tool`)
  return tool
}

describe('taskTools', () => {
  it('completes a declared task by the id task_declare returned', async () => {
    const tools = taskTools()
    const declared = await call<{ ok: boolean; id: string }>(byName(tools, 'task_declare'), { what: 'count the files' })
    expect(declared.ok).toBe(true)

    const completed = await call<{ ok: boolean; id: string }>(byName(tools, 'task_complete'), { id: declared.id })

    expect(completed).toEqual({ ok: true, id: declared.id })
  })

  it('refuses to complete a task twice', async () => {
    const tools = taskTools()
    const { id } = await call<{ id: string }>(byName(tools, 'task_declare'), { what: 'one unit' })
    await byName(tools, 'task_complete').handler({ id })

    await expect(byName(tools, 'task_complete').handler({ id })).rejects.toThrow(`no declared task with id '${id}'`)
  })

  it("keeps each agent's declarations apart: one registry per call", async () => {
    const first = taskTools()
    const { id } = await call<{ id: string }>(byName(first, 'task_declare'), { what: 'first agent' })

    await expect(byName(taskTools(), 'task_complete').handler({ id })).rejects.toThrow('no declared task')
  })
})

describe('questionTool', () => {
  it('answers no_asker at once and says the question belongs in the reply', async () => {
    const tool = questionTool()

    const answer = await call<{ ok: boolean; error: string }>(tool, { question: 'which file?' })

    expect(tool.name).toBe('question')
    expect(answer).toMatchObject({ ok: false, error: 'no_asker' })
    expect(tool.description).toContain('reply')
  })
})
