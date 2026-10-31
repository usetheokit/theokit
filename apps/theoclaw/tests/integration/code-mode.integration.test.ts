/**
 * B-386 — `run_code` and `delegate_all` on a `/control` agent across their real boundaries: real
 * SDK agents built by `createTheoClawAgent`, the QuickJS sandbox, the published file tools on a
 * real tool root, and an OpenAI-compatible model stub over HTTP standing in for the model. The
 * worker of `delegate_all` is built by the same factory and talks to the same stub, so the requests
 * the stub records are what the parent and the worker each sent.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../../src/agent/create-agent.js'
import type { TurnAgent } from '../../src/agent-port.js'
import { codeModeTool, delegateAllTool, type CreateWorker } from '../../src/tools/code-mode-tools.js'
import { vetoToolCall } from '../../src/tools/path-veto.js'
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

function settingsWithState(): ToolSettings {
  const workspace = makeHostToolsWorkspace()
  cleanups.push(() => workspace.remove())
  mkdirSync(join(workspace.path, '.theoclaw'), { recursive: true })
  writeFileSync(join(workspace.path, '.theoclaw', 'sessions.json'), 'state')
  return resolveToolSettings({}, workspace.path, { detect: () => ({ ok: true, bin: '/usr/bin/bwrap' }), warn: () => undefined })
}

async function stubOf(replies: readonly StubReply[]): Promise<ModelStub> {
  const stub = await startModelStub(replies)
  cleanups.push(() => stub.close())
  return stub
}

/** One `/control` turn through the stub; its workers come from the same factory. */
async function controlTurn(settings: ToolSettings, stub: ModelStub, prompt: string): Promise<void> {
  const build = (toolOptions: AgentToolOptions): Promise<TurnAgent> =>
    createTheoClawAgent(theoClawAgentOptions({ model: { id: 'lmstudio/stub', url: stub.url }, apiKey: 'stub-key', toolOptions }))
  const agent = await createTheoClawAgent(
    theoClawAgentOptions({ model: { id: 'lmstudio/stub', url: stub.url }, apiKey: 'stub-key', toolOptions: controlAgentToolOptions(settings, build) }),
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

function toolMessages(stub: ModelStub, index: number): string[] {
  const messages = (stub.requests[index]?.messages ?? []) as { role: string; content: unknown }[]
  return messages.filter((message) => message.role === 'tool').map((message) => JSON.stringify(message.content))
}

const neverBuilt: CreateWorker = () => Promise.reject(new Error('no worker expected'))

describe('run_code and delegate_all on a /control agent, over the model stub', () => {
  it('advertises run_code with the generated instructions and delegate_all over one worker', async () => {
    const settings = settingsWithState()
    const stub = await stubOf([{ text: 'ok' }])

    await controlTurn(settings, stub, 'hello')

    const tools = (stub.requests[0]?.tools ?? []) as { function: { name: string; description: string } }[]
    const advertised = new Map(tools.map((tool) => [tool.function.name, tool.function.description]))
    expect(advertised.get('run_code')).toBe(codeModeTool(readOnlyTools(settings), settings).description)
    expect(advertised.get('run_code')).toContain('JavaScript')
    expect(advertised.get('run_code')).toContain('await api.list_dir({ path: string })')
    expect(advertised.get('delegate_all')).toBe(delegateAllTool(neverBuilt).description)
  })

  it('answers a script that reads the state directory with the veto the plugin applies', async () => {
    const settings = settingsWithState()
    const code = 'return await api.read_file({ path: "../.theoclaw/sessions.json" })'
    const stub = await stubOf([{ toolCalls: [{ name: 'run_code', args: { code } }] }, { text: 'refused' }])

    await controlTurn(settings, stub, 'read the session file')

    const refusal = vetoToolCall('read_file', { path: '../.theoclaw/sessions.json' }, settings)
    expect(refusal).toBeDefined()
    const answer = toolMessages(stub, 1).join('\n')
    expect(answer).toContain(String(refusal))
    expect(answer).not.toContain('"state"')
  })

  it('runs a delegate_all worker with only the read-only tools and returns its answer to the parent', async () => {
    const settings = settingsWithState()
    const stub = await stubOf([
      { toolCalls: [{ name: 'delegate_all', args: { tasks: [{ agent: 'worker', task: 'say the token' }] } }] },
      { text: 'worker-token-7f3a' },
      { text: 'the worker said worker-token-7f3a' },
    ])

    await controlTurn(settings, stub, 'ask a worker')

    expect(stub.requests).toHaveLength(3)
    expect(advertisedTools(stub.requests[1])).toEqual(readOnlyTools(settings).map((tool) => tool.name).sort())
    expect(toolMessages(stub, 2).join('\n')).toContain('worker-token-7f3a')
  })
})
