import type { CustomTool, SDKAgent } from '@theokit/sdk'
import { WorkflowToolError } from '@theokit/sdk/workflow'
import { describe, expect, it } from 'vitest'

import type { TheoClawAgentOptions } from '../src/agent/create-agent.js'
import { createContainer } from '../src/composition.js'
import { createChannelAgentFactory } from '../src/control-plane/agent-factory.js'
import { createWorkflowTools } from '../src/workflows/workflow-tools.js'

const ENV = { THEOCLAW_MODEL: 'openrouter/m', OPENROUTER_API_KEY: 'router-key' }
const GOOD_DRAFT = '- first point\n- second point'

interface DraftHarness {
  tool: CustomTool
  readonly lines: string[]
  readonly created: TheoClawAgentOptions[]
  disposals: number
}

/**
 * The `digest` tool over the real request boundary and the real channel factory, with a fake
 * `create`: each agent it builds answers every turn with `draftFor(call)` and counts its disposal.
 */
function harness(draftFor: (call: number) => string = () => GOOD_DRAFT, disposeError?: Error): DraftHarness {
  const state: DraftHarness = { tool: undefined as unknown as CustomTool, lines: [], created: [], disposals: 0 }
  const create = async (options: TheoClawAgentOptions): Promise<SDKAgent> => {
    const call = state.created.push(options)
    const send = async () => ({ wait: async () => ({ status: 'finished', result: draftFor(call) }) })
    const dispose = async (): Promise<void> => {
      state.disposals += 1
      if (disposeError !== undefined) throw disposeError
    }
    return { agentId: `agent-draft-${call}`, send, [Symbol.asyncDispose]: dispose } as unknown as SDKAgent
  }
  const boundary = createContainer({ factory: createChannelAgentFactory(ENV, create) })
  const [tool] = createWorkflowTools({ withDraftAgent: boundary.withAgent, write: (line) => state.lines.push(line) })
  state.tool = tool as CustomTool
  return state
}

const call = (tool: CustomTool, text: string): Promise<unknown> => Promise.resolve(tool.handler({ text }))

describe('the digest tool', () => {
  it('names the tool digest', () => {
    const tools = createWorkflowTools({ withDraftAgent: createContainer({ factory: async () => ({}) as SDKAgent }).withAgent, write: () => {} })
    expect(tools.map((tool) => tool.name)).toEqual(['digest'])
  })

  it('returns no tool when no draft factory is given', () => {
    expect(createWorkflowTools({ write: () => {} })).toEqual([])
  })

  it('builds each draft agent with shell withheld, memory off and no tool', async () => {
    const draft = harness()
    await call(draft.tool, 'a text to digest')
    expect(draft.created).toHaveLength(1)
    const [captured] = draft.created
    expect(captured?.withheldBuiltinTools).toEqual(['shell'])
    expect(captured?.memory).toEqual({ enabled: false })
    expect(captured?.tools).toBeUndefined()
  })

  it('returns the points of a completed run to the model', async () => {
    const draft = harness()
    expect(JSON.parse(String(await call(draft.tool, 'a text to digest')))).toEqual({ points: ['first point', 'second point'] })
  })

  it('disposes the draft agent after completed and failed runs', async () => {
    const draft = harness((n) => (n % 2 === 0 ? 'only prose, no point' : GOOD_DRAFT))
    const outcomes = await Promise.allSettled(Array.from({ length: 10 }, () => call(draft.tool, 'a text to digest')))
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(5)
    expect(draft.disposals).toBe(10)
  })

  it('logs one line per run and none of the text', async () => {
    const draft = harness()
    const text = 'secret-ish text the log must not carry'
    await call(draft.tool, text)
    expect(draft.lines).toEqual([expect.stringMatching(/^theoclaw-workflow: digest wfr-\S+ completed 2\/2 steps$/)])
    expect(draft.lines.join()).not.toContain(text)
  })

  it('logs a failed line and raises WorkflowToolError when the draft has no point', async () => {
    const draft = harness(() => 'only prose, no point')
    await expect(call(draft.tool, 'a text to digest')).rejects.toBeInstanceOf(WorkflowToolError)
    expect(draft.lines).toEqual([expect.stringMatching(/^theoclaw-workflow: digest wfr-\S+ failed 1\/2 steps$/)])
  })

  it('logs a not-started line when the draft agent cannot be built', async () => {
    const lines: string[] = []
    const refused = new TypeError('Agent.create refused the key')
    const boundary = createContainer<SDKAgent>({ factory: () => Promise.reject(refused) })
    const [tool] = createWorkflowTools({ withDraftAgent: boundary.withAgent, write: (line) => lines.push(line) })
    await expect(call(tool as CustomTool, 'a text to digest')).rejects.toBe(refused)
    expect(lines).toEqual(['theoclaw-workflow: digest - not-started 0/2 steps TypeError'])
  })

  it('logs only the run line when disposing the agent fails after a completed run', async () => {
    const draft = harness(() => GOOD_DRAFT, new Error('dispose failed'))
    await expect(call(draft.tool, 'a text to digest')).rejects.toThrow()
    expect(draft.lines).toEqual([expect.stringMatching(/completed 2\/2 steps$/)])
  })

  it('refuses an empty text before any draft agent is built', async () => {
    const draft = harness()
    await expect(call(draft.tool, '')).rejects.toThrow()
    expect(draft.created).toHaveLength(0)
    expect(draft.lines).toEqual([])
  })

  it('gives two concurrent calls two draft agents and two run ids', async () => {
    const draft = harness()
    const first = call(draft.tool, 'the first text')
    const second = call(draft.tool, 'the second text')
    await Promise.all([first, second])
    expect(draft.created).toHaveLength(2)
    const runIds = draft.lines.map((line) => line.split(' ')[2])
    expect(new Set(runIds).size).toBe(2)
  })
})
