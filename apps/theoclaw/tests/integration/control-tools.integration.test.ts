/**
 * B-611 — `delegate`, `question`, `task_declare` and `task_complete` on a `/control` agent, read
 * from what the model receives: real SDK agents built by `createTheoClawAgent` with the options a
 * `/control` agent gets (`controlAgentToolOptions`), and an OpenAI-compatible model stub over HTTP
 * standing in for the model. The `delegate` worker is built by the same factory and talks to the
 * same stub, so the requests the stub records are what the parent and the worker each sent.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../../src/agent/create-agent.js'
import type { TurnAgent } from '../../src/agent-port.js'
import { controlAgentToolOptions, readOnlyTools } from '../../src/tools/tool-registry.js'
import type { AgentToolOptions } from '../../src/tools/tool-registry.js'
import { resolveToolSettings } from '../../src/tools/tool-settings.js'
import type { ToolSettings } from '../../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from '../host-tools-workspace.js'
import { advertisedTools, startModelStub } from '../model-stub.js'
import type { ModelStub, StubReply } from '../model-stub.js'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

function settings(): ToolSettings {
  const workspace = makeHostToolsWorkspace()
  cleanups.push(() => workspace.remove())
  return resolveToolSettings({}, workspace.path, { detect: () => ({ ok: true, bin: '/usr/bin/bwrap' }), warn: () => undefined })
}

async function stubOf(replies: readonly StubReply[]): Promise<ModelStub> {
  const stub = await startModelStub(replies)
  cleanups.push(() => stub.close())
  return stub
}

/** One `/control` turn through the stub; its workers come from the same factory. */
async function controlTurn(toolSettings: ToolSettings, stub: ModelStub, prompt: string): Promise<void> {
  const build = (toolOptions: AgentToolOptions): Promise<TurnAgent> =>
    createTheoClawAgent(theoClawAgentOptions({ model: { id: 'lmstudio/stub', url: stub.url }, apiKey: 'stub-key', toolOptions }))
  const agent = await createTheoClawAgent(
    theoClawAgentOptions({ model: { id: 'lmstudio/stub', url: stub.url }, apiKey: 'stub-key', toolOptions: controlAgentToolOptions(toolSettings, build) }),
  )
  try {
    const run = await agent.send(prompt)
    for await (const _event of run.stream()) {
      // Drained, so the run proceeds; the stub records what each request carried.
    }
    await run.wait()
  } finally {
    await agent[Symbol.asyncDispose]()
  }
}

function toolMessages(stub: ModelStub, index: number): string {
  const messages = (stub.requests[index]?.messages ?? []) as { role: string; content: unknown }[]
  return messages
    .filter((message) => message.role === 'tool')
    .map((message) => JSON.stringify(message.content))
    .join('\n')
}

describe('delegate, question and the task tools on a /control agent, over the model stub', () => {
  it('advertises delegate, question, task_declare and task_complete to the model', async () => {
    const stub = await stubOf([{ text: 'ok' }])

    await controlTurn(settings(), stub, 'hello')

    expect(advertisedTools(stub.requests[0])).toEqual(expect.arrayContaining(['delegate', 'question', 'task_declare', 'task_complete']))
  })

  it('runs a delegate worker with only the read-only tools and returns its answer to the parent', async () => {
    const toolSettings = settings()
    const stub = await stubOf([
      { toolCalls: [{ name: 'delegate', args: { agent: 'worker', task: 'say the token' } }] },
      { text: 'worker-token-91c2' },
      { text: 'the worker said worker-token-91c2' },
    ])

    await controlTurn(toolSettings, stub, 'ask a worker')

    expect(stub.requests).toHaveLength(3)
    expect(advertisedTools(stub.requests[1])).toEqual([...readOnlyTools(toolSettings).map((tool) => tool.name), 'skill_read'].sort())
    expect(toolMessages(stub, 2)).toContain('worker-token-91c2')
  })

  it('answers question with no_asker at once, since a /control turn has nobody to ask mid-turn', async () => {
    const stub = await stubOf([{ toolCalls: [{ name: 'question', args: { question: 'which file?' } }] }, { text: 'asked in the reply' }])

    await controlTurn(settings(), stub, 'ask me something')

    expect(toolMessages(stub, 1)).toContain('no_asker')
  })

  it('answers task_declare with the id of the declared task', async () => {
    const stub = await stubOf([
      { toolCalls: [{ name: 'task_declare', args: { what: 'count the files' } }] },
      // The id is made at run time, so the stub cannot complete it; `control-tools.test.ts` does.
      { text: 'declared' },
    ])

    await controlTurn(settings(), stub, 'declare a task')

    expect(toolMessages(stub, 1)).toMatch(/\\"ok\\":true,\\"id\\":\\"[^"\\]+\\"/)
  })
})
